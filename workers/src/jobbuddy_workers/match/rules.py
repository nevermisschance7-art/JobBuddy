"""Hard filters and the /100 score. Pure functions, no AI, no I/O.

Unknown or unverified information never earns full points.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from functools import lru_cache

from ..geo import COUNTRIES, region_covers
from ..jobs.normalize import norm_key
from .tech import job_terms, main_stack, role_families

# The score is tech fit only (0-100). Location, remote, seniority and sponsorship are pass/fail
# filters; their parts are kept in the breakdown as information for the job card, with the
# point scales below, but they are not added to the score.
WEIGHTS = {
    "technical": 100,
    "seniority": 20,
    "eligibility": 20,
    "remote": 10,
    "freshness": 10,
    "compensation": 5,
}
SENIORITY_ORDER = ["junior", "mid", "senior", "lead", "principal"]
HOT_SCORE = 85
SIM_FLOOR = 0.35
SIM_FULL = 0.60


@dataclass
class UserFilters:
    countries_allowed: list[str] = field(default_factory=list)
    # Remote jobs limited to these countries are shown too (e.g. US remote, as a contractor).
    remote_extra_countries: list[str] = field(default_factory=list)
    needs_sponsorship: bool = False
    remote_types: list[str] = field(default_factory=lambda: ["remote", "hybrid", "onsite"])
    hybrid_max_office_days: int | None = None
    seniority_levels: list[str] = field(default_factory=list)
    must_have_skills: list[str] = field(default_factory=list)
    excluded_skills: list[str] = field(default_factory=list)
    excluded_companies: list[str] = field(default_factory=list)
    salary_floor: float | None = None
    salary_currency: str | None = None
    employment_types: list[str] = field(default_factory=lambda: ["full_time"])
    cv_skills: list[str] = field(default_factory=list)
    # From the confirmed CV: technologies with weights, and kinds of role held.
    cv_terms: dict[str, float] = field(default_factory=dict)
    cv_roles: set[str] = field(default_factory=set)


@dataclass
class JobFacts:
    id: str
    title: str
    company_name: str
    countries: list[str]
    remote_regions: list[str]
    remote_type: str | None
    employment_type: str
    seniority: str
    description_text: str
    posted_at: datetime | None
    similarity: float
    salary_min: float | None = None
    salary_max: float | None = None
    salary_currency: str | None = None
    tags: list[str] = field(default_factory=list)


@dataclass
class Result:
    passed: bool
    score: int
    breakdown: dict[str, dict[str, object]]
    reasons_failed: list[str]
    # True when the score was lowered because the job is not close to the CV.
    capped: bool = False


# ---------------------------------------------------------------- text checks

_NO_SPONSOR = re.compile(
    r"(no|not|unable to|cannot|can't|won't|will not|do not|does not|don't)\s+"
    r"(offer|provide|support|sponsor)\w*\s+(any\s+)?(visa|work permit|sponsorship|immigration)"
    r"|without\s+(the\s+)?(need\s+for\s+)?(visa\s+)?sponsorship"
    r"|sponsorship\s+(is\s+)?not\s+(available|offered|provided|possible)"
    r"|must\s+(already\s+)?have\s+(the\s+)?(full\s+|existing\s+|valid\s+)?right\s+to\s+work",
    re.I,
)
_SPONSOR_OK = re.compile(
    r"(visa|relocation)\s+sponsorship\s+(is\s+)?(available|offered|provided)"
    r"|we\s+(can|will|do)\s+sponsor|(?<!not )sponsorship\s+available"
    r"|(?<!not )(?<!n't )(?<!never )offer\s+visa\s+sponsorship",
    re.I,
)
_OFFICE_DAYS = re.compile(
    r"(\d)\s*(?:\+\s*)?(?:days?|x)\s*(?:a|per|/)?\s*(?:week)?\s*(?:in|at|from)\s+(?:the\s+|our\s+)?office"
    r"|(?:in|at)\s+(?:the\s+)?office\s+(\d)\s*(?:days?|x)",
    re.I,
)
_WORDS = {"one": "1", "two": "2", "three": "3", "four": "4", "five": "5"}


def says_no_sponsorship(text: str) -> bool:
    return bool(_NO_SPONSOR.search(text)) and not _SPONSOR_OK.search(text)


def says_sponsorship_available(text: str) -> bool:
    return bool(_SPONSOR_OK.search(text))


def office_days(text: str) -> int | None:
    t = re.sub(
        r"\b(one|two|three|four|five)\b", lambda m: _WORDS[m.group(1).lower()], text, flags=re.I
    )
    days = [int(a or b) for a, b in _OFFICE_DAYS.findall(t)]
    return max(days) if days else None


def mentions(text: str, skill: str) -> bool:
    """Whole-word, case-insensitive. Handles C++, C#, .NET, Node.js."""
    s = re.escape(skill.strip().lower())
    return bool(re.search(rf"(?<![a-z0-9+#.]){s}(?![a-z0-9+#])", text.lower()))


# ---------------------------------------------------------------- filters


def location_fit(
    job: JobFacts, allowed: list[str], remote_extra: list[str] | None = None
) -> tuple[str, str]:
    """('country'|'region'|'open_remote'|'remote_abroad'|'none', reason)."""
    allowed_set = set(allowed)
    hit = allowed_set & set(job.countries)
    if hit:
        return "country", f"Based in {', '.join(COUNTRIES.get(c, c) for c in sorted(hit))}"
    for region in job.remote_regions:
        if any(region_covers(region, c) for c in allowed_set):
            label = "anywhere" if region == "WORLDWIDE" else region.replace("_", " ").title()
            return "region", f"Remote, open to {label}"
    if job.remote_type == "remote" and not job.countries and not job.remote_regions:
        return "open_remote", "Remote, location limits not stated"
    abroad = set(remote_extra or []) & set(job.countries)
    if job.remote_type == "remote" and abroad:
        names = ", ".join(COUNTRIES.get(c, c) for c in sorted(abroad))
        return "remote_abroad", f"Remote, {names} only. You may need to work as a contractor"
    return "none", "Not in a country you can work in"


def hard_filters(job: JobFacts, f: UserFilters) -> list[str]:
    reasons: list[str] = []
    text = f"{job.title}\n{job.description_text}"

    if (
        f.countries_allowed
        and location_fit(job, f.countries_allowed, f.remote_extra_countries)[0] == "none"
    ):
        reasons.append("location")
    if f.needs_sponsorship and says_no_sponsorship(job.description_text):
        reasons.append("no_sponsorship")
    if job.remote_type and job.remote_type not in f.remote_types:
        reasons.append("remote_type")
    if job.remote_type == "hybrid" and f.hybrid_max_office_days is not None:
        days = office_days(job.description_text)
        if days is not None and days > f.hybrid_max_office_days:
            reasons.append("office_days")
    if (
        f.seniority_levels
        and job.seniority != "unknown"
        and job.seniority not in f.seniority_levels
    ):
        reasons.append("seniority")
    if any(mentions(text, s) for s in f.excluded_skills):
        reasons.append("excluded_skill")
    excluded = {norm_key(c) for c in f.excluded_companies}
    if norm_key(job.company_name) in excluded:
        reasons.append("excluded_company")
    if job.employment_type != "unknown" and job.employment_type not in f.employment_types:
        reasons.append("employment_type")
    return reasons


# ---------------------------------------------------------------- score


def _part(points: float, max_points: int, reason: str) -> dict[str, object]:
    return {"points": round(max(0.0, min(points, max_points)), 1), "reason": reason}


@lru_cache(maxsize=20_000)
def _job_terms(job_id: str, title: str, description: str) -> tuple[tuple[str, float], ...]:
    # Same job, many users: worked out once per run.
    return tuple(job_terms(title, description).items())


def _closeness(similarity: float) -> float:
    """0 to 1 from CV/job text closeness. Calibrated on real data (MiniLM, CV vs job):
    median job ~0.33, best matches ~0.60."""
    return max(0.0, min(1.0, (similarity - SIM_FLOOR) / (SIM_FULL - SIM_FLOOR)))


def technical(job: JobFacts, f: UserFilters) -> dict[str, object]:
    """Tech fit only: the technologies the job asks for against the ones the CV shows.

    60 points: share of the job's technologies the CV has (title 3x, required 1-2x,
               "nice to have" 0.4x).
    25 points: the person's main stack (their most used technologies) is in the job.
    15 points: the kind of role (backend, platform, data...) matches their own titles.
    A job ad that names fewer than two technologies, or a CV without any, falls back to how
    close the CV and the ad read (so vague ads neither shine nor vanish).
    """
    weights = dict(_job_terms(job.id, job.title, f"{job.description_text}\n{' '.join(job.tags)}"))
    cv = f.cv_terms
    if len(weights) < 2 or not cv:
        points = 85 * _closeness(job.similarity)
        return _part(
            points, WEIGHTS["technical"], "Few technologies named; scored by closeness to your CV"
        )

    have = sorted((t for t in weights if t in cv), key=lambda t: -weights[t])
    coverage = sum(weights[t] for t in have) / sum(weights.values())
    stack = [t for t in main_stack(cv) if t in weights]
    job_roles = role_families(job.title)
    if not job_roles:
        role_points = 8.0  # a general engineering title
    elif job_roles & f.cv_roles:
        role_points = 15.0
    else:
        role_points = 0.0
    tech_points = 60 * coverage + 25 * min(1.0, len(stack) / 2) + role_points
    # An ad naming only a few technologies says little: trust the technology match less and
    # blend in the text closeness (full trust from about six required technologies).
    trust = min(1.0, sum(weights.values()) / 6)
    points = trust * tech_points + (1 - trust) * 85 * _closeness(job.similarity)

    # Must-have skills the user set: missing ones pull the score down.
    if f.must_have_skills:
        text = f"{job.title}\n{job.description_text}"
        found = sum(1 for s in f.must_have_skills if mentions(text, s))
        points *= 0.5 + 0.5 * found / len(f.must_have_skills)

    reason = f"You have {len(have)} of the {len(weights)} technologies it asks for" + (
        f" ({', '.join(have[:4])})" if have else ""
    )
    return _part(points, WEIGHTS["technical"], reason)


def seniority(job: JobFacts, f: UserFilters) -> dict[str, object]:
    if job.seniority == "unknown":
        return _part(10, 20, "Level not stated")
    if not f.seniority_levels:
        return _part(14, 20, f"{job.seniority.title()} level")
    if job.seniority in f.seniority_levels:
        return _part(20, 20, f"{job.seniority.title()}, your level")
    idx = SENIORITY_ORDER.index(job.seniority) if job.seniority in SENIORITY_ORDER else -1
    near = any(
        abs(idx - SENIORITY_ORDER.index(lv)) == 1
        for lv in f.seniority_levels
        if lv in SENIORITY_ORDER
    )
    return _part(10 if near else 0, 20, f"{job.seniority.title()} level")


def eligibility(job: JobFacts, f: UserFilters) -> dict[str, object]:
    kind, reason = (
        location_fit(job, f.countries_allowed, f.remote_extra_countries)
        if f.countries_allowed
        else ("open_remote", "No country filter set")
    )
    points = {"country": 20, "region": 17, "open_remote": 10, "remote_abroad": 6, "none": 0}[kind]
    # Chip for the job card: indicated | sponsorship_stated | unclear | restriction.
    chip = {"country": "indicated", "region": "indicated"}.get(kind, "unclear")
    if kind in ("none", "remote_abroad") or says_no_sponsorship(job.description_text):
        chip = "restriction"
    if f.needs_sponsorship:
        if says_sponsorship_available(job.description_text):
            reason += ", sponsorship stated"
            chip = "sponsorship_stated"
        else:
            points = min(points, 12)
            reason += ", sponsorship not mentioned"
            if chip == "indicated":
                chip = "unclear"
    return {**_part(points, 20, reason), "chip": chip}


def remote(job: JobFacts, f: UserFilters) -> dict[str, object]:
    if job.remote_type is None:
        return _part(5, 10, "Work style not stated")
    return _part(10, 10, f"{job.remote_type.title()}, as you want")


def freshness(job: JobFacts, now: datetime) -> dict[str, object]:
    if job.posted_at is None:
        return _part(3, 10, "Date unknown")
    age = now - job.posted_at
    if age < timedelta(hours=24):
        return _part(10, 10, "Posted today")
    if age < timedelta(hours=72):
        return _part(8, 10, f"Posted {age.days or 1} day{'s' if age.days > 1 else ''} ago")
    if age < timedelta(days=14):
        return _part(5, 10, f"Posted {age.days} days ago")
    return _part(2, 10, f"Posted {age.days} days ago")


def compensation(job: JobFacts, f: UserFilters) -> dict[str, object]:
    top = job.salary_max or job.salary_min
    if top is None:
        return _part(2, 5, "Salary not stated")
    if not f.salary_floor:
        return _part(4, 5, "Salary stated")
    if f.salary_currency and job.salary_currency and f.salary_currency != job.salary_currency:
        return _part(3, 5, f"Salary stated in {job.salary_currency}")
    if top >= f.salary_floor:
        return _part(5, 5, "Pay meets your floor")
    return _part(0, 5, "Pay below your floor")


def evaluate(job: JobFacts, f: UserFilters, now: datetime) -> Result:
    breakdown = {
        "technical": technical(job, f),
        "seniority": seniority(job, f),
        "eligibility": eligibility(job, f),
        "remote": remote(job, f),
        "freshness": freshness(job, now),
        "compensation": compensation(job, f),
    }
    score = round(float(breakdown["technical"]["points"]))  # type: ignore[arg-type]
    reasons = hard_filters(job, f)
    return Result(
        passed=not reasons,
        score=max(0, min(100, score)),
        breakdown=breakdown,
        reasons_failed=reasons,
    )


def top_reasons(result: Result, n: int = 3) -> list[str]:
    """One-liners for the job card: the tech fit first, then eligibility and freshness."""
    keys = ["technical", "eligibility", "freshness", "seniority", "compensation"]
    return [str(result.breakdown[k]["reason"]) for k in keys if k in result.breakdown][:n]


def is_hot(result: Result, job: JobFacts, now: datetime) -> bool:
    return (
        result.passed
        and result.score >= HOT_SCORE
        and job.posted_at is not None
        and now - job.posted_at < timedelta(hours=24)
    )
