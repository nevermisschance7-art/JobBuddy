"""House style for generated text. Mirrors style.ts: no em dashes, no buzzwords,
over-length text is flagged, never cut."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

_SENTENCE_START = "SENTENCE_START"

_REPLACEMENTS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bI am passionate about\b", re.I), "I care about"),
    (re.compile(r"\bI'm passionate about\b", re.I), "I care about"),
    (re.compile(r"\bI am excited to\b", re.I), "I'd like to"),
    (re.compile(r"\bI'm excited to\b", re.I), "I'd like to"),
    (re.compile(r"\bleveraging\b", re.I), "using"),
    (re.compile(r"\bleveraged\b", re.I), "used"),
    (re.compile(r"\bleverages\b", re.I), "uses"),
    (re.compile(r"\bleverage\b", re.I), "use"),
    (re.compile(r"\butili[sz]ing\b", re.I), "using"),
    (re.compile(r"\butili[sz]ed\b", re.I), "used"),
    (re.compile(r"\butili[sz]e\b", re.I), "use"),
    (re.compile(r"\bdelve into\b", re.I), "look into"),
    (re.compile(r"\bdelving into\b", re.I), "looking into"),
    (
        re.compile(r"(^|[.!?]\s+)(?:Furthermore|Moreover|Additionally),\s+(\w)"),
        _SENTENCE_START,
    ),
    (re.compile(r"\b(?:furthermore|moreover)\b", re.I), "also"),
]

BANNED_WORDS = [
    "delve",
    "dynamic",
    "fast-paced",
    "synergy",
    "synergies",
    "passionate",
    "rockstar",
    "ninja",
    "go-getter",
    "thought leader",
    "game-changer",
    "cutting-edge",
    "results-driven",
    "detail-oriented",
    "team player",
    "tapestry",
    "testament to",
]


@dataclass
class StyleResult:
    text: str
    word_count: int
    over_limit: bool
    flags: list[str] = field(default_factory=list)


def count_words(text: str) -> int:
    return len(text.split())


def _match_case(original: str, replacement: str) -> str:
    if original[:1] and original[0] == original[0].upper() and replacement:
        return replacement[0].upper() + replacement[1:]
    return replacement


def apply_style(text_in: str, max_words: int) -> StyleResult:
    text = text_in.strip()
    text = re.sub(r"\s*—\s*", ", ", text)
    text = re.sub(r"\s+–\s+", ", ", text)

    for pattern, replacement in _REPLACEMENTS:
        if replacement == _SENTENCE_START:
            text = pattern.sub(lambda m: m.group(1) + m.group(2).upper(), text)
        else:
            text = pattern.sub(lambda m, r=replacement: _match_case(m.group(0), r), text)

    text = re.sub(r",\s*,", ",", text)
    text = re.sub(r"\s+([,.;!?])", r"\1", text)
    text = re.sub(r"[ \t]{2,}", " ", text).strip()

    flags: list[str] = []
    lower = text.lower()
    for word in BANNED_WORDS:
        pattern = r"\b" + re.sub(r"[-\s]", r"[-\\s]", word) + r"\b"
        if re.search(pattern, lower):
            flags.append(f'Uses "{word}". Consider plainer wording.')

    words = count_words(text)
    over = words > max_words
    if over:
        flags.append(f"{words} words, over the {max_words}-word limit. Please shorten.")
    return StyleResult(text=text, word_count=words, over_limit=over, flags=flags)
