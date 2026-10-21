"""Recognise employer-system job-board URLs and pull out the company slug."""

from __future__ import annotations

import re

# (system, pattern). Group 1 is the slug; Lever's EU host becomes "eu:<slug>".
_SLUG = r"([A-Za-z0-9_-]+)"
PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    (
        "greenhouse",
        re.compile(
            r"(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io/(?:embed/job_board\?for=)?" + _SLUG,
            re.I,
        ),
    ),
    ("greenhouse", re.compile(r"boards-api\.greenhouse\.io/v1/boards/" + _SLUG, re.I)),
    ("lever", re.compile(r"jobs\.(eu\.)?lever\.co/([A-Za-z0-9_.-]+)", re.I)),
    ("ashby", re.compile(r"jobs\.ashbyhq\.com/([A-Za-z0-9_.%-]+)", re.I)),
    ("workable", re.compile(r"apply\.workable\.com/" + _SLUG, re.I)),
    ("smartrecruiters", re.compile(r"(?:jobs|careers)\.smartrecruiters\.com/" + _SLUG, re.I)),
    ("teamtailor", re.compile(r"//([a-z0-9-]+)\.teamtailor\.com", re.I)),
]

# Path segments that are part of the site, not a company.
RESERVED = {
    "api", "embed", "j", "jobs", "job", "www", "app", "apply", "careers", "career", "static",
    "assets", "images", "img", "css", "js", "login", "signup", "search", "sitemap", "robots.txt",
    "favicon.ico", "privacy", "terms", "help", "support", "cdn", "media", "v0", "v1", "oauth",
    "candidate", "candidates", "account", "accounts", "public", "widget", "en", "de", "fr",
}  # fmt: skip

# Slugs are matched case-sensitively only on SmartRecruiters.
CASE_SENSITIVE = {"smartrecruiters"}


def slugs_in(text: str) -> set[tuple[str, str]]:
    """Every (system, slug) mentioned in a URL or a block of text."""
    found: set[tuple[str, str]] = set()
    for ats, pattern in PATTERNS:
        for m in pattern.finditer(text):
            if ats == "lever":
                eu, slug = m.group(1), m.group(2)
                slug = f"eu:{slug.lower()}" if eu else slug.lower()
            else:
                slug = m.group(1)
                if ats not in CASE_SENSITIVE:
                    slug = slug.lower()
            bare = slug.removeprefix("eu:")
            if bare.lower() in RESERVED or len(bare) < 2 or bare.isdigit():
                continue
            found.add((ats, slug))
    return found
