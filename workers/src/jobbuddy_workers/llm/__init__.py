"""Free-tier LLM router (Gemini, Groq, OpenRouter; Anthropic optional). Mirrors
packages/shared/src/llm in TypeScript."""

from .fake import FakeProvider
from .redact import Redactor
from .router import AllProvidersFailedError, LlmOutputError, LlmRouter
from .style import StyleResult, apply_style
from .types import LlmError, PersonalInfo, ProviderKey

__all__ = [
    "AllProvidersFailedError",
    "FakeProvider",
    "LlmError",
    "LlmOutputError",
    "LlmRouter",
    "PersonalInfo",
    "ProviderKey",
    "Redactor",
    "StyleResult",
    "apply_style",
]
