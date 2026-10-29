import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from pydantic import BaseModel

from jobbuddy_workers.llm import (
    AllProvidersFailedError,
    FakeProvider,
    LlmError,
    LlmOutputError,
    LlmRouter,
    PersonalInfo,
    ProviderKey,
    Redactor,
    apply_style,
)
from jobbuddy_workers.llm.config import load_config
from jobbuddy_workers.llm.json_repair import parse_loose_json
from jobbuddy_workers.llm.providers import next_pacific_midnight, parse_duration

VECTORS = json.loads(
    (Path(__file__).resolve().parents[2] / "packages/shared/src/llm/test-vectors.json").read_text(
        encoding="utf-8"
    )
)

# ------------------------------------------------------------------ shared vectors


@pytest.mark.parametrize("v", VECTORS["style"], ids=lambda v: v["input"][:40])
def test_style_vectors(v):
    r = apply_style(v["input"], v["maxWords"])
    assert r.text == v["text"]
    assert r.over_limit == v["overLimit"]
    for f in v["flagsContain"]:
        assert f in " | ".join(r.flags)
    if not v["flagsContain"]:
        assert r.flags == []


@pytest.mark.parametrize("v", VECTORS["redaction"])
def test_redaction_vectors(v):
    p = v["personal"]
    r = Redactor(
        PersonalInfo(
            name=p["name"],
            email=p["email"],
            phone=p["phone"],
            address=p["address"],
            fixed_answers=p["fixedAnswers"],
        )
    )
    out = r.redact(v["input"])
    assert out == v["redacted"]
    for s in v["mustNotContain"]:
        assert s not in out
    assert r.restore("Hi {{NAME}}, {{FIXED_1}}") == f"Hi {p['name']}, {p['fixedAnswers'][0]}"


@pytest.mark.parametrize("v", VECTORS["jsonRepair"])
def test_json_repair_vectors(v):
    assert parse_loose_json(v["input"]) == v["parsed"]


# ------------------------------------------------------------------ router

CONFIG = {
    "order": ["gemini", "groq", "openrouter", "anthropic"],
    "providers": {
        "gemini": {"enabled": True, "models": ["g-new", "g-old"]},
        "groq": {"enabled": True, "models": ["q-1"]},
        "openrouter": {"enabled": True, "models": ["o-1"]},
        "anthropic": {"enabled": False, "models": ["c-1"]},
    },
    "tasks": {"t": {"temperature": 0, "maxOutputTokens": 100}},
}
NOW = datetime(2026, 10, 21, 12, 0, tzinfo=UTC)


class Thing(BaseModel):
    title: str
    years: int


class Store:
    def __init__(self, keys):
        self.keys = keys
        self.cooled = []
        self.broken = []

    def get_keys(self, user_id):
        return self.keys

    def mark_cooling_down(self, user_id, provider, until, error):
        self.cooled.append((provider, until))

    def mark_broken(self, user_id, provider, error):
        self.broken.append(provider)


class Sinks:
    def __init__(self):
        self.logs = []
        self.alerts = []

    def log_call(self, entry):
        self.logs.append(entry)

    def needs_fixing(self, user_id, message):
        self.alerts.append(message)


def make(keys, shared=None):
    fakes = {n: FakeProvider(n) for n in ["gemini", "groq", "openrouter", "anthropic"]}
    store, sinks = Store(keys), Sinks()
    router = LlmRouter(
        store, sinks, config=CONFIG, providers=fakes, shared_keys=shared, now=lambda: NOW
    )
    return router, fakes, store, sinks


def key(provider, cooling_until=None):
    return ProviderKey(provider, f"{provider}-key", cooling_until)


def test_first_provider_works_and_is_logged():
    router, fakes, _, sinks = make([key("gemini")])
    fakes["gemini"].queue('{"title":"Dev","years":3}')
    assert router.generate_json("t", Thing, "p", "u1") == Thing(title="Dev", years=3)
    assert sinks.logs[0].provider == "gemini" and sinks.logs[0].ok


def test_rate_limit_falls_back_and_cools_down():
    until = datetime(2026, 10, 21, 12, 5, tzinfo=UTC)
    router, fakes, store, _ = make([key("gemini"), key("groq")])
    fakes["gemini"].queue(LlmError("rate_limit", "slow", until))
    fakes["groq"].queue('{"title":"x","years":1}')
    assert router.generate_json("t", Thing, "p", "u1").years == 1
    assert store.cooled == [("gemini", until)]


def test_cooling_provider_is_skipped():
    router, fakes, _, _ = make(
        [key("gemini", datetime(2026, 10, 21, 13, 0, tzinfo=UTC)), key("groq")]
    )
    fakes["groq"].queue('{"title":"x","years":0}')
    router.generate_json("t", Thing, "p", "u1")
    assert fakes["gemini"].requests == []


def test_missing_model_tries_next_model():
    router, fakes, _, _ = make([key("gemini")])
    fakes["gemini"].queue(LlmError("model_not_found", "404"), '{"title":"x","years":0}')
    router.generate_json("t", Thing, "p", "u1")
    assert [r.model for _, r in fakes["gemini"].requests] == ["g-new", "g-old"]


def test_bad_key_is_marked_broken():
    router, fakes, store, _ = make([key("gemini"), key("groq")])
    fakes["gemini"].queue(LlmError("auth", "bad"))
    fakes["groq"].queue('{"title":"x","years":0}')
    router.generate_json("t", Thing, "p", "u1")
    assert store.broken == ["gemini"]


def test_shared_key_used_after_own_keys():
    router, fakes, _, _ = make([], shared={"openrouter": "shared-key"})
    fakes["openrouter"].queue('{"title":"x","years":0}')
    router.generate_json("t", Thing, "p", "u1")
    assert fakes["openrouter"].requests[0][0] == "shared-key"


def test_disabled_provider_never_called_and_alert_raised():
    router, fakes, _, sinks = make([key("anthropic")])
    with pytest.raises(AllProvidersFailedError, match="No AI key"):
        router.generate_text("t", "p", 50, "u1")
    assert fakes["anthropic"].requests == []
    assert len(sinks.alerts) == 1


def test_all_failing_raises_alert():
    router, fakes, _, sinks = make([key("gemini"), key("groq")])
    fakes["gemini"].queue(LlmError("quota", "daily"))
    fakes["groq"].queue(LlmError("server", "500"))
    with pytest.raises(AllProvidersFailedError):
        router.generate_json("t", Thing, "p", "u1")
    assert len(sinks.alerts) == 1
    assert "out of quota" in sinks.alerts[0]


def test_only_timeouts_say_the_ai_is_busy():
    router, fakes, _, sinks = make([key("gemini"), key("groq")])
    for _ in range(4):
        fakes["gemini"].queue(LlmError("network", "timeout"))
        fakes["groq"].queue(LlmError("server", "503"))
    with pytest.raises(AllProvidersFailedError):
        router.generate_json("t", Thing, "p", "u1")
    assert "too busy" in sinks.alerts[0]


def test_retry_with_validation_error_then_success():
    router, fakes, _, _ = make([key("gemini")])
    fakes["gemini"].queue('{"title":"x","years":"two"}', '{"title":"x","years":2}')
    assert router.generate_json("t", Thing, "p", "u1").years == 2
    assert "years" in fakes["gemini"].requests[1][1].prompt


def test_still_invalid_fails_cleanly():
    router, fakes, _, _ = make([key("gemini")])
    fakes["gemini"].queue("not json", '{"title":1}')
    with pytest.raises(LlmOutputError):
        router.generate_json("t", Thing, "p", "u1")


def test_personal_details_and_fixed_answers_never_sent():
    router, fakes, _, _ = make([key("gemini")])
    fakes["gemini"].queue('{"title":"Thanks from {{NAME}}","years":1}')
    result = router.generate_json(
        "t",
        Thing,
        "Sam Tester, sam@x.io, needs sponsorship: Tier 2 visa required",
        "u1",
        personal=PersonalInfo(
            name="Sam Tester", email="sam@x.io", fixed_answers=["Tier 2 visa required"]
        ),
    )
    sent = repr(fakes["gemini"].requests)
    assert "Sam Tester" not in sent and "sam@x.io" not in sent and "Tier 2 visa" not in sent
    assert result.title == "Thanks from Sam Tester"


def test_text_style_and_length_flag():
    router, fakes, _, _ = make([key("gemini")])
    fakes["gemini"].queue("I leverage Go — daily. " * 10)
    r = router.generate_text("t", "p", 20, "u1")
    assert "—" not in r.text and "leverage" not in r.text.lower()
    assert r.over_limit


def test_helpers():
    assert parse_duration("30s") == 30
    assert parse_duration("2m59.5s") == 179.5
    assert parse_duration("soon") is None
    assert next_pacific_midnight(NOW) == datetime(2026, 10, 22, 8, 0, tzinfo=UTC)


def test_real_config_is_valid():
    cfg = load_config()
    assert set(cfg["order"]) == set(cfg["providers"])
    for p in cfg["providers"].values():
        assert p["models"], "every provider needs at least one model"
    assert cfg["providers"]["anthropic"]["enabled"] is False


def test_server_error_tries_next_model_and_logs_reason():
    router, fakes, _, sinks = make([key("gemini")])
    fakes["gemini"].queue(LlmError("server", "503 model overloaded"), '{"title":"x","years":0}')
    router.generate_json("t", Thing, "p", "u1")
    assert [r.model for _, r in fakes["gemini"].requests] == ["g-new", "g-old"]
    assert sinks.logs[0].error_message == "503 model overloaded"
