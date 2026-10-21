"""Turning messy source fields into clean, comparable values."""

from __future__ import annotations

import hashlib
import html
import re
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from typing import Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from ..geo import fold

RemoteType = Literal["remote", "hybrid", "onsite"]
Seniority = Literal["junior", "mid", "senior", "lead", "principal", "unknown"]
EmploymentType = Literal["full_time", "part_time", "contract", "temporary", "unknown"]

MAX_DESCRIPTION_CHARS = 15_000

# ---------------------------------------------------------------- text


class _TextExtractor(HTMLParser):
    BLOCK = {
        "p",
        "div",
        "br",
        "li",
        "ul",
        "ol",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "tr",
        "section",
    }

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in ("script", "style"):
            self.skip += 1
        elif tag == "li":
            self.parts.append("\n- ")
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style"):
            self.skip = max(0, self.skip - 1)
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.skip:
            self.parts.append(data)


def html_to_text(value: str | None) -> str:
    """HTML (possibly entity-escaped, as Greenhouse sends it) to readable plain text."""
    if not value:
        return ""
    raw = value
    if "&lt;" in raw and "<" not in raw:
        raw = html.unescape(raw)
    parser = _TextExtractor()
    parser.feed(raw)
    text = "".join(parser.parts).replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text[:MAX_DESCRIPTION_CHARS]


def norm_key(text: str) -> str:
    """For dedupe: folded, punctuation and company suffixes removed."""
    t = fold(text)
    t = re.sub(r"[^a-z0-9 ]+", " ", t)
    t = re.sub(r"\b(inc|llc|ltd|limited|gmbh|ag|sa|bv|plc|corp|corporation|co)\b", " ", t)
    return re.sub(r"\s+", " ", t).strip()


# ---------------------------------------------------------------- dates


def from_epoch(value: int | float | str | None) -> datetime | None:
    if value in (None, "", 0):
        return None
    v = float(value)  # type: ignore[arg-type]
    if v > 1e11:  # milliseconds
        v /= 1000
    return datetime.fromtimestamp(v, UTC)


def from_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    v = value.strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(v)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def from_rfc822(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = parsedate_to_datetime(value.strip())
    except (TypeError, ValueError):
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def from_dmy(value: str | None) -> datetime | None:
    """Reed's "dd/mm/yyyy"."""
    if not value:
        return None
    try:
        return datetime.strptime(value.strip(), "%d/%m/%Y").replace(tzinfo=UTC)
    except ValueError:
        return None


# ---------------------------------------------------------------- classification

_TECH_TITLE = re.compile(
    r"\b(engineer|engineering|developer|programmer|software|swe|sde|devops|sre|"
    r"site reliability|platform|infrastructure|backend|back-end|frontend|front-end|"
    r"full[- ]?stack|mobile|ios|android|web|data|machine learning|ml|ai|llm|"
    r"scientist|analytics|architect|security|cloud|qa|test|automation|firmware|embedded|"
    r"technical lead|tech lead|cto|vp of engineering|head of engineering|research engineer|"
    r"python|java|golang|rust|typescript|javascript|react|node|kotlin|swift|ruby|php|\.net|c\+\+|"
    r"database|dba|network|systems|game|graphics|blockchain|solidity)\b",
    re.I,
)
_NOT_TECH = re.compile(
    r"\b(sales engineer|account executive|recruiter|sales development|"
    r"customer success manager|marketing manager)\b",
    re.I,
)
_INTERNSHIP = re.compile(
    r"\b(intern|internship|praktikum|praktikant|werkstudent|working student|stage|stagiaire|"
    r"apprentice|apprenticeship|ausbildung|trainee|co-op|thesis|abschlussarbeit)\b",
    re.I,
)


def is_tech_role(title: str) -> bool:
    return bool(_TECH_TITLE.search(title)) and not _NOT_TECH.search(title)


def is_internship(*texts: str | None) -> bool:
    return any(t and _INTERNSHIP.search(t) for t in texts)


def seniority_from(title: str, extra: str | None = None) -> Seniority:
    t = f"{title} {extra or ''}".lower()
    if re.search(r"\b(principal|distinguished|staff|fellow)\b", t):
        return "principal"
    if re.search(r"\b(lead|head of|manager|director|vp|chief)\b", t):
        return "lead"
    if re.search(r"\b(senior|sr\.?|snr|iii|level 3|l5|l6)\b", t):
        return "senior"
    if re.search(r"\b(junior|jr\.?|graduate|entry[- ]level|new grad|associate|i\b)", t):
        return "junior"
    if re.search(r"\b(mid[- ]?level|intermediate|ii)\b", t):
        return "mid"
    return "unknown"


def employment_from(*texts: str | None) -> EmploymentType:
    t = " ".join(x for x in texts if x).lower()
    if re.search(r"part[- ]?time|teilzeit", t):
        return "part_time"
    if re.search(r"contract|freelance|contractor|b2b", t):
        return "contract"
    if re.search(r"temporary|temp\b|fixed[- ]term|befristet|limited", t):
        return "temporary"
    if re.search(r"full[- ]?time|permanent|vollzeit|fulltime|cdi\b", t):
        return "full_time"
    return "unknown"


def remote_type_from(explicit: str | None, *texts: str | None) -> RemoteType | None:
    """Explicit source field first ("remote", "hybrid", "on-site", ...), then the text."""
    if explicit:
        e = explicit.lower().replace("-", "").replace("_", "").replace(" ", "")
        if e in ("remote", "fullyremote", "fully", "true"):
            return "remote"
        if e == "hybrid":
            return "hybrid"
        if e in ("onsite", "inoffice", "office", "false", "none"):
            return "onsite"
    t = " ".join(x for x in texts if x).lower()
    if re.search(r"\bhybrid\b", t):
        return "hybrid"
    if re.search(r"\bremote\b|work from home|wfh|anywhere", t):
        return "remote"
    if re.search(r"\bon[- ]?site\b|\bin[- ]office\b", t):
        return "onsite"
    return None


# ---------------------------------------------------------------- urls and hashes

_KEEP_QUERY = {"gh_jid", "jobid", "job_id", "id", "lever-source"}


def canonical_url(url: str) -> str:
    """Lower-case host, no tracking params, no trailing slash. Keeps job-id params."""
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return url.strip()
    query = urlencode(
        sorted(
            (k, v) for k, v in parse_qsl(parts.query) if k.lower() in _KEEP_QUERY - {"lever-source"}
        )
    )
    path = parts.path.rstrip("/") or "/"
    return urlunsplit(("https", parts.netloc.lower().removeprefix("www."), path, query, ""))


def content_hash(*values: object) -> str:
    h = hashlib.sha256()
    for v in values:
        h.update(repr(v).encode("utf-8"))
        h.update(b"\x00")
    return h.hexdigest()[:32]


def dedupe_key(company: str, title: str, countries: list[str]) -> str:
    # Company spaces are ignored: "Grafana Labs" and "grafanalabs" are the same company.
    company_key = norm_key(company).replace(" ", "")
    return f"{company_key}|{norm_key(title)}|{countries[0] if countries else 'REMOTE'}"


def utcnow() -> datetime:
    return datetime.now(UTC)
