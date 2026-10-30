"""Technologies in a text, from the list the web app uses too (shared tech-terms.json).

The tech-fit score compares the technologies a job asks for with the ones the CV shows.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from functools import cache
from pathlib import Path
from typing import Any

# workers/src/jobbuddy_workers/match/tech.py -> repository root
_TERMS_FILE = Path(__file__).resolve().parents[4] / "packages/shared/src/cv/tech-terms.json"


@cache
def _patterns() -> list[tuple[str, re.Pattern[str]]]:
    data = json.loads(_TERMS_FILE.read_text(encoding="utf-8"))
    synonyms: dict[str, str] = data["synonyms"]
    out = []
    for term in dict.fromkeys([*data["terms"], *synonyms]):
        canonical = synonyms.get(term, term)
        # Whole words: not inside another word, and "java" is not "javascript".
        pattern = re.compile(rf"(?<![a-z0-9+#.]){re.escape(term)}(?![a-z0-9+#])", re.IGNORECASE)
        out.append((canonical, pattern))
    return out


# Languages almost everyone lists next to their real stack: never a stack on their own.
_NOT_STACK = {"sql", "bash", "powershell"}


@cache
def core_terms() -> frozenset[str]:
    """Languages and frameworks: the list's first part, up to "graphql" (see its comment)."""
    data = json.loads(_TERMS_FILE.read_text(encoding="utf-8"))
    terms: list[str] = data["terms"]
    return frozenset(terms[: terms.index("graphql")]) - _NOT_STACK


def term_counts(text: str) -> Counter[str]:
    """How often each known technology is mentioned (canonical names)."""
    counts: Counter[str] = Counter()
    for canonical, pattern in _patterns():
        n = len(pattern.findall(text))
        if n:
            counts[canonical] += n
    return counts


# Where "nice to have" starts in a job ad: technologies only after this weigh less.
_NICE = re.compile(
    r"nice to have|nice-to-have|bonus|a plus|would be great|preferred qualifications|"
    r"good to have|desirable|not required|optional",
    re.IGNORECASE,
)


def job_terms(title: str, description: str) -> dict[str, float]:
    """The job's technologies with weights: in the title 3, required 1 (2 if repeated),
    only in a "nice to have" part 0.4."""
    cut = _NICE.search(description)
    required = description[: cut.start()] if cut else description
    nice = description[cut.start() :] if cut else ""
    weights: dict[str, float] = {}
    for term, n in term_counts(required).items():
        weights[term] = 2.0 if n >= 2 else 1.0
    for term in term_counts(nice):
        weights.setdefault(term, 0.4)
    for term in term_counts(title):
        weights[term] = 3.0
    return weights


def cv_terms(resume: dict[str, Any]) -> dict[str, float]:
    """The CV's technologies with weights: listed skills count double, plus every mention in
    roles, highlights, summary and projects. Higher = more central to the person's work.
    People list their main language or framework first in a skills group, so the first
    ones there weigh more (a PHP developer's CV may name a cloud tool more often than PHP)."""
    weights: Counter[str] = Counter()
    lead = (6, 4, 2)
    for group in resume.get("skills") or []:
        core_seen = 0
        for kw in group.get("keywords") or []:
            if isinstance(kw, str):
                for term in term_counts(kw):
                    weights[term] += 2
                    if term in core_terms():
                        weights[term] += lead[core_seen] if core_seen < len(lead) else 0
                        core_seen += 1
    text = json.dumps(
        {
            "basics": {k: (resume.get("basics") or {}).get(k) for k in ("label", "summary")},
            "work": resume.get("work") or [],
            "projects": resume.get("projects") or [],
        }
    )
    for term, n in term_counts(text).items():
        weights[term] += n
    return dict(weights)


def main_stack(cv: dict[str, float], n: int = 3) -> list[str]:
    """The person's main languages and frameworks (cloud and tools don't make a stack)."""
    core = [(t, w) for t, w in cv.items() if t in core_terms()]
    return [t for t, _ in sorted(core, key=lambda kv: -kv[1])[:n]]


# Kinds of role, to compare a job title with the person's own titles.
ROLE_FAMILIES = {
    "backend": r"back.?end|server|api",
    "frontend": r"front.?end|ui engineer|web developer",
    "fullstack": r"full.?stack",
    "mobile": r"mobile|ios|android|react native|flutter",
    "platform": r"platform|infrastructure|devops|sre|site reliability|cloud",
    "data": r"data engineer|analytics engineer|etl|data platform",
    "ml": r"machine learning|\bml\b|\bai\b|llm|data scien",
    "qa": r"\bqa\b|quality|test automation|sdet",
    "security": r"security|appsec|devsecops",
}


def role_families(title: str) -> set[str]:
    t = title.lower()
    return {family for family, pattern in ROLE_FAMILIES.items() if re.search(pattern, t)}
