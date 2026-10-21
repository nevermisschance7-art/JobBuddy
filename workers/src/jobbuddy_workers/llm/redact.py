"""Replace personal details and fixed answers with placeholders. Mirrors redact.ts."""

from __future__ import annotations

import re
from typing import Any

from .types import PersonalInfo


def _phone_pattern(phone: str) -> str | None:
    digits = re.sub(r"\D", "", phone)
    if len(digits) < 7:
        return None
    return "".join((r"\+?" + d) if i == 0 else (r"[\s().-]*" + d) for i, d in enumerate(digits))


class Redactor:
    def __init__(self, info: PersonalInfo):
        self._terms: list[tuple[str, str]] = []

        def add(value: str | None, placeholder: str, min_length: int = 3) -> None:
            v = (value or "").strip()
            if len(v) >= min_length:
                self._terms.append((v, placeholder))

        add(info.name, "{{NAME}}")
        add(info.email, "{{EMAIL}}")
        add(info.address, "{{ADDRESS}}", 6)
        for i, answer in enumerate(info.fixed_answers):
            add(answer, f"{{{{FIXED_{i + 1}}}}}", 4)
        parts = [p for p in (info.name or "").split() if len(p) >= 3]
        if len(parts) > 1:
            add(parts[0], "{{FIRST_NAME}}")
            add(parts[-1], "{{LAST_NAME}}")

        self._terms.sort(key=lambda t: len(t[0]), reverse=True)
        self._patterns: list[tuple[re.Pattern[str], str]] = [
            (
                re.compile(r"(?<![\w@])" + re.escape(value) + r"(?![\w@])", re.I | re.A),
                placeholder,
            )
            for value, placeholder in self._terms
        ]
        phone = _phone_pattern(info.phone) if info.phone else None
        if phone and info.phone:
            self._terms.append((info.phone.strip(), "{{PHONE}}"))
            self._patterns.insert(0, (re.compile(phone), "{{PHONE}}"))

    def redact(self, text: str) -> str:
        for pattern, placeholder in self._patterns:
            text = pattern.sub(placeholder, text)
        return text

    def restore(self, text: str) -> str:
        for value, placeholder in self._terms:
            text = text.replace(placeholder, value)
        return text

    def restore_deep(self, value: Any) -> Any:
        if isinstance(value, str):
            return self.restore(value)
        if isinstance(value, list):
            return [self.restore_deep(v) for v in value]
        if isinstance(value, dict):
            return {k: self.restore_deep(v) for k, v in value.items()}
        return value
