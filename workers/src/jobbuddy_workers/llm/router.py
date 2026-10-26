"""LLM router with free-tier fallback. Mirrors router.ts."""

from __future__ import annotations

import contextlib
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

from .config import load_config
from .json_repair import parse_loose_json
from .providers import PROVIDERS
from .redact import Redactor
from .style import StyleResult, apply_style
from .types import (
    KeyStore,
    LlmCallLog,
    LlmError,
    LlmProvider,
    LlmRequest,
    LlmSinks,
    PersonalInfo,
    ProviderKey,
    ProviderName,
)

M = TypeVar("M", bound=BaseModel)

_COOLDOWN_KINDS = {"rate_limit", "quota"}
_MODEL_LEVEL_ERRORS = {"model_not_found", "server", "bad_request", "network"}
_NO_KEY = "No AI key is set up. Add a free Gemini key in Settings."
_ALL_FAILED = (
    "All your AI keys are out of quota or not working right now. "
    "Check Settings, or add a backup key."
)


class AllProvidersFailedError(Exception):
    def __init__(self, attempts: list[str]):
        super().__init__(
            _NO_KEY if not attempts else "Every AI provider failed: " + "; ".join(attempts)
        )
        self.attempts = attempts


class LlmOutputError(Exception):
    pass


class LlmRouter:
    def __init__(
        self,
        keys: KeyStore,
        sinks: LlmSinks,
        config: dict[str, Any] | None = None,
        providers: dict[str, LlmProvider] | None = None,
        shared_keys: dict[str, str] | None = None,
        now: Callable[[], datetime] | None = None,
    ):
        self.keys = keys
        self.sinks = sinks
        self.config = config or load_config()
        self.providers: dict[str, LlmProvider] = {**PROVIDERS, **(providers or {})}
        self.shared_keys = shared_keys or {}
        self.now = now or (lambda: datetime.now(UTC))

    def generate_json(
        self,
        task: str,
        schema: type[M],
        prompt: str,
        user_id: str,
        system: str | None = None,
        personal: PersonalInfo | None = None,
    ) -> M:
        redactor = Redactor(personal or PersonalInfo())
        full_system = "\n\n".join(
            s
            for s in [
                system,
                "Reply with one JSON value only. No markdown, no comments, "
                "no text before or after it.",
            ]
            if s
        )
        safe_prompt = redactor.redact(prompt)
        safe_system = redactor.redact(full_system)

        first = self._call(task, user_id, safe_system, safe_prompt, json_mode=True)
        ok, value, error = self._validate(first, schema, redactor)
        if ok:
            return value  # type: ignore[return-value]
        retry_prompt = (
            f"{safe_prompt}\n\nYour previous reply was not valid:\n{error}\n\n"
            "Reply again with corrected JSON only."
        )
        second = self._call(task, user_id, safe_system, retry_prompt, json_mode=True)
        ok, value, error = self._validate(second, schema, redactor)
        if ok:
            return value  # type: ignore[return-value]
        raise LlmOutputError(f"The AI's answer for {task} was not valid: {error}")

    def generate_text(
        self,
        task: str,
        prompt: str,
        max_words: int,
        user_id: str,
        system: str | None = None,
        personal: PersonalInfo | None = None,
    ) -> StyleResult:
        redactor = Redactor(personal or PersonalInfo())
        full_system = "\n\n".join(
            s
            for s in [
                system,
                f"Write at most {max_words} words. Plain, specific, first person. "
                "No em dashes. No buzzwords.",
            ]
            if s
        )
        raw = self._call(
            task, user_id, redactor.redact(full_system), redactor.redact(prompt), json_mode=False
        )
        return apply_style(redactor.restore(raw), max_words)

    def _validate(
        self, raw: str, schema: type[M], redactor: Redactor
    ) -> tuple[bool, M | None, str]:
        try:
            parsed = parse_loose_json(raw)
        except ValueError as e:
            return False, None, f"Not valid JSON ({e})."
        try:
            return True, schema.model_validate(redactor.restore_deep(parsed)), ""
        except ValidationError as e:
            issues = [
                f"{'.'.join(str(p) for p in err['loc']) or '(root)'}: {err['msg']}"
                for err in e.errors()[:8]
            ]
            return False, None, "\n".join(issues)

    def _call(self, task: str, user_id: str, system: str, prompt: str, json_mode: bool) -> str:
        task_cfg = self.config["tasks"].get(task, {"temperature": 0.3, "maxOutputTokens": 2048})
        user_keys = self.keys.get_keys(user_id)
        now = self.now()
        attempts: list[str] = []

        for name in self.config["order"]:
            pcfg = self.config["providers"].get(name)
            if not pcfg or not pcfg.get("enabled"):
                continue
            candidates: list[tuple[ProviderKey, bool]] = [
                (k, False) for k in user_keys if k.provider == name
            ]
            if name in self.shared_keys:
                candidates.append((ProviderKey(name, self.shared_keys[name]), True))

            for key, shared in candidates:
                if key.cooling_until and key.cooling_until > now:
                    attempts.append(f"{name} cooling down until {key.cooling_until.isoformat()}")
                    continue
                req = LlmRequest(
                    model="",
                    prompt=prompt,
                    system=system or None,
                    json=json_mode,
                    temperature=task_cfg["temperature"],
                    max_output_tokens=task_cfg["maxOutputTokens"],
                )
                ok, text, error = self._try_provider(name, key, task, user_id, req)
                if ok:
                    return text
                assert error is not None
                attempts.append(f"{name}: {error.kind}")
                if not shared:
                    if error.kind in _COOLDOWN_KINDS:
                        until = error.retry_at or now + timedelta(seconds=60)
                        self.keys.mark_cooling_down(user_id, name, until, str(error))
                    elif error.kind == "auth":
                        self.keys.mark_broken(user_id, name, str(error))

        self.sinks.needs_fixing(user_id, _NO_KEY if not attempts else _ALL_FAILED)
        raise AllProvidersFailedError(attempts)

    def _try_provider(
        self, name: ProviderName, key: ProviderKey, task: str, user_id: str, base: LlmRequest
    ) -> tuple[bool, str, LlmError | None]:
        provider = self.providers[name]
        last = LlmError("model_not_found", "no models configured")
        for model in self.config["providers"][name]["models"]:
            started = time.monotonic()
            req = LlmRequest(
                model=model,
                prompt=base.prompt,
                system=base.system,
                json=base.json,
                temperature=base.temperature,
                max_output_tokens=base.max_output_tokens,
            )
            try:
                res = provider.generate(key.api_key, req)
                self._log(
                    user_id, task, name, model, started, True, res.input_tokens, res.output_tokens
                )
                return True, res.text, None
            except LlmError as e:
                last = e
            except Exception as e:  # noqa: BLE001 - any provider bug counts as a server error
                last = LlmError("server", str(e))
            self._log(user_id, task, name, model, started, False, None, None, last.kind, str(last))
            # Key-level problems end this provider; a model-level one tries its next model.
            if last.kind not in _MODEL_LEVEL_ERRORS:
                break
        return False, "", last

    def _log(
        self,
        user_id: str,
        task: str,
        provider: ProviderName,
        model: str,
        started: float,
        ok: bool,
        input_tokens: int | None,
        output_tokens: int | None,
        error_kind: str | None = None,
        error_message: str | None = None,
    ) -> None:
        # Usage logging must never break a call.
        with contextlib.suppress(Exception):
            self.sinks.log_call(
                LlmCallLog(
                    user_id=user_id,
                    task=task,
                    provider=provider,
                    model=model,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    latency_ms=int((time.monotonic() - started) * 1000),
                    ok=ok,
                    error_kind=error_kind,  # type: ignore[arg-type]
                    error_message=error_message[:300] if error_message else None,
                )
            )
