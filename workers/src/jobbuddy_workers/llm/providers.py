"""Provider connectors. Mirrors providers.ts."""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime, timedelta

import httpx

from .types import LlmError, LlmRequest, LlmResponse, ProviderName

TIMEOUT = 60.0


def parse_duration(value: str | None) -> float | None:
    """Seconds from "30s", "2m59.5s", "1h2m", "500ms" or plain seconds."""
    if not value:
        return None
    v = value.strip()
    if re.fullmatch(r"\d+(\.\d+)?", v):
        return float(v)
    total, matched = 0.0, False
    for n, unit in re.findall(r"(\d+(?:\.\d+)?)(ms|h|m|s)", v):
        matched = True
        x = float(n)
        total += {"h": x * 3600, "m": x * 60, "s": x, "ms": x / 1000}[unit]
    return total if matched else None


def next_pacific_midnight(now: datetime) -> datetime:
    reset = now.astimezone(UTC).replace(hour=8, minute=0, second=0, microsecond=0)
    return reset if reset > now else reset + timedelta(days=1)


def _now() -> datetime:
    return datetime.now(UTC)


def _post(url: str, headers: dict[str, str], body: dict) -> httpx.Response:
    try:
        return httpx.post(url, headers=headers, json=body, timeout=TIMEOUT)
    except httpx.HTTPError as e:
        raise LlmError("network", str(e)) from e


def _error_from_status(status: int, body: str, retry_at: datetime | None = None) -> LlmError:
    short = body[:300]
    if status in (401, 403):
        return LlmError("auth", short)
    if status == 404:
        return LlmError("model_not_found", short)
    if status == 429:
        return LlmError("rate_limit", short, retry_at)
    if status >= 500:
        return LlmError("server", short)
    return LlmError("bad_request", short)


class Gemini:
    name: ProviderName = "gemini"

    def generate(self, api_key: str, req: LlmRequest) -> LlmResponse:
        body: dict = {
            "contents": [{"role": "user", "parts": [{"text": req.prompt}]}],
            "generationConfig": {
                "temperature": req.temperature,
                "maxOutputTokens": req.max_output_tokens,
                **({"responseMimeType": "application/json"} if req.json else {}),
            },
        }
        if req.system:
            body["systemInstruction"] = {"parts": [{"text": req.system}]}
        res = _post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{req.model}:generateContent",
            {"x-goog-api-key": api_key},
            body,
        )
        text = res.text
        if res.status_code >= 400:
            if res.status_code == 400 and "API key not valid" in text:
                raise LlmError("auth", text[:300])
            if res.status_code == 400 and "User location is not supported" in text:
                raise LlmError("auth", "Gemini is not available from this server's location")
            if res.status_code == 429:
                daily = bool(re.search(r"PerDay|per day", text, re.I))
                m = re.search(r'"retryDelay":\s*"([^"]+)"', text)
                delay = parse_duration(m.group(1) if m else None)
                retry_at = (
                    next_pacific_midnight(_now())
                    if daily
                    else _now() + timedelta(seconds=delay or 60)
                )
                raise LlmError("quota" if daily else "rate_limit", text[:300], retry_at)
            raise _error_from_status(res.status_code, text)
        data = json.loads(text)
        parts = ((data.get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
        out = "".join(p.get("text", "") for p in parts)
        if not out:
            raise LlmError("server", "Gemini returned no text")
        usage = data.get("usageMetadata") or {}
        return LlmResponse(out, usage.get("promptTokenCount"), usage.get("candidatesTokenCount"))


class OpenAiCompatible:
    def __init__(
        self,
        name: ProviderName,
        base_url: str,
        json_mode: bool,
        extra_headers: dict[str, str] | None = None,
    ):
        self.name = name
        self.base_url = base_url
        self.json_mode = json_mode
        self.extra_headers = extra_headers or {}

    def generate(self, api_key: str, req: LlmRequest) -> LlmResponse:
        messages = ([{"role": "system", "content": req.system}] if req.system else []) + [
            {"role": "user", "content": req.prompt}
        ]
        body: dict = {
            "model": req.model,
            "messages": messages,
            "temperature": req.temperature,
            "max_tokens": req.max_output_tokens,
        }
        if req.json and self.json_mode:
            body["response_format"] = {"type": "json_object"}
        res = _post(
            f"{self.base_url}/chat/completions",
            {"Authorization": f"Bearer {api_key}", **self.extra_headers},
            body,
        )
        text = res.text
        if res.status_code >= 400:
            wait = (
                parse_duration(res.headers.get("retry-after"))
                or parse_duration(res.headers.get("x-ratelimit-reset-requests"))
                or parse_duration(res.headers.get("x-ratelimit-reset-tokens"))
            )
            if res.status_code == 429 and re.search(
                r"per day|daily|free-models-per-day", text, re.I
            ):
                raise LlmError("quota", text[:300], _now() + timedelta(hours=6))
            if re.search(r"not a valid model|model_not_found|does not exist", text, re.I):
                raise LlmError("model_not_found", text[:300])
            raise _error_from_status(res.status_code, text, _now() + timedelta(seconds=wait or 60))
        data = json.loads(text)
        if data.get("error"):
            raise LlmError("server", str(data["error"].get("message", "provider error")))
        choices = data.get("choices") or [{}]
        out = (choices[0].get("message") or {}).get("content") or ""
        if not out:
            raise LlmError("server", f"{self.name} returned no text")
        usage = data.get("usage") or {}
        return LlmResponse(out, usage.get("prompt_tokens"), usage.get("completion_tokens"))


class Anthropic:
    name: ProviderName = "anthropic"

    def generate(self, api_key: str, req: LlmRequest) -> LlmResponse:
        body: dict = {
            "model": req.model,
            "max_tokens": req.max_output_tokens,
            "temperature": req.temperature,
            "messages": [{"role": "user", "content": req.prompt}],
        }
        if req.system:
            body["system"] = req.system
        res = _post(
            "https://api.anthropic.com/v1/messages",
            {"x-api-key": api_key, "anthropic-version": "2023-06-01"},
            body,
        )
        if res.status_code >= 400:
            wait = parse_duration(res.headers.get("retry-after"))
            raise _error_from_status(
                res.status_code, res.text, _now() + timedelta(seconds=wait or 60)
            )
        data = res.json()
        out = "".join(c.get("text", "") for c in data.get("content", []) if c.get("type") == "text")
        if not out:
            raise LlmError("server", "Anthropic returned no text")
        usage = data.get("usage") or {}
        return LlmResponse(out, usage.get("input_tokens"), usage.get("output_tokens"))


PROVIDERS = {
    "gemini": Gemini(),
    "groq": OpenAiCompatible("groq", "https://api.groq.com/openai/v1", json_mode=True),
    "cerebras": OpenAiCompatible("cerebras", "https://api.cerebras.ai/v1", json_mode=True),
    "mistral": OpenAiCompatible("mistral", "https://api.mistral.ai/v1", json_mode=True),
    "openrouter": OpenAiCompatible(
        "openrouter",
        "https://openrouter.ai/api/v1",
        json_mode=False,
        extra_headers={"X-Title": "JobBuddy"},
    ),
    "anthropic": Anthropic(),
}
