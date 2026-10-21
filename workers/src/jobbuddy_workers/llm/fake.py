"""Scripted provider for tests. Mirrors fake.ts."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import replace

from .types import LlmError, LlmRequest, LlmResponse, ProviderName

Step = str | LlmError | Callable[[LlmRequest], str]


class FakeProvider:
    def __init__(self, name: ProviderName, steps: list[Step] | None = None):
        self.name = name
        self.steps: list[Step] = list(steps or [])
        self.requests: list[tuple[str, LlmRequest]] = []

    def queue(self, *steps: Step) -> FakeProvider:
        self.steps.extend(steps)
        return self

    def generate(self, api_key: str, req: LlmRequest) -> LlmResponse:
        self.requests.append((api_key, replace(req)))
        if not self.steps:
            raise RuntimeError(f"FakeProvider {self.name}: no step queued")
        step = self.steps.pop(0)
        if isinstance(step, LlmError):
            raise step
        text = step(req) if callable(step) else step
        return LlmResponse(text, 10, 5)
