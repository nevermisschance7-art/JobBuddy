"""Shared types for the LLM router. Mirrors packages/shared/src/llm/types.ts."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal, Protocol

ProviderName = Literal["gemini", "groq", "openrouter", "anthropic"]
ErrorKind = Literal[
    "rate_limit", "quota", "auth", "model_not_found", "bad_request", "server", "network"
]


@dataclass
class LlmRequest:
    model: str
    prompt: str
    json: bool
    temperature: float
    max_output_tokens: int
    system: str | None = None


@dataclass
class LlmResponse:
    text: str
    input_tokens: int | None = None
    output_tokens: int | None = None


class LlmError(Exception):
    def __init__(self, kind: ErrorKind, message: str, retry_at: datetime | None = None):
        super().__init__(message)
        self.kind = kind
        self.retry_at = retry_at


class LlmProvider(Protocol):
    name: ProviderName

    def generate(self, api_key: str, req: LlmRequest) -> LlmResponse: ...


@dataclass
class ProviderKey:
    provider: ProviderName
    api_key: str
    cooling_until: datetime | None = None


class KeyStore(Protocol):
    def get_keys(self, user_id: str) -> list[ProviderKey]: ...
    def mark_cooling_down(
        self, user_id: str, provider: ProviderName, until: datetime, error: str
    ) -> None: ...
    def mark_broken(self, user_id: str, provider: ProviderName, error: str) -> None: ...


@dataclass
class LlmCallLog:
    user_id: str
    task: str
    provider: ProviderName
    model: str
    input_tokens: int | None
    output_tokens: int | None
    latency_ms: int
    ok: bool
    error_kind: ErrorKind | None
    error_message: str | None = None


class LlmSinks(Protocol):
    def log_call(self, entry: LlmCallLog) -> None: ...
    def needs_fixing(self, user_id: str, message: str) -> None: ...


@dataclass
class PersonalInfo:
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    address: str | None = None
    fixed_answers: list[str] = field(default_factory=list)
