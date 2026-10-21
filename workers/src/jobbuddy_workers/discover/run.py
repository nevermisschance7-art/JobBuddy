"""Weekly company discovery.

1. Collect candidate (system, slug) pairs from links in stored jobs and from the
   Common Crawl URL index.
2. Check each new one is live (its board lists at least one job) and insert it.
3. Deactivate companies that failed 5 fetch runs in a row; re-check inactive ones monthly.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

import httpx

from ..http import USER_AGENT
from ..jobs.sources import EMPLOYER_SOURCES, Company
from .slugs import slugs_in

log = logging.getLogger(__name__)

FAILS_BEFORE_DEACTIVATE = 5
RECHECK_INACTIVE_AFTER = timedelta(days=30)
MAX_NEW_CHECKS = 1500  # per run, to keep the weekly job short
CHECK_CONCURRENCY = 8

CC_PATTERNS = {
    "greenhouse": ["boards.greenhouse.io/*", "job-boards.greenhouse.io/*"],
    "lever": ["jobs.lever.co/*", "jobs.eu.lever.co/*"],
    "ashby": ["jobs.ashbyhq.com/*"],
    "workable": ["apply.workable.com/*"],
    "smartrecruiters": ["jobs.smartrecruiters.com/*", "careers.smartrecruiters.com/*"],
    "teamtailor": ["*.teamtailor.com"],
}


@dataclass
class KnownCompany:
    id: str
    ats: str
    slug: str
    active: bool
    fail_count: int
    checked_at: datetime | None


class DiscoveryStore(Protocol):
    def companies(self) -> list[KnownCompany]: ...
    def job_link_texts(self) -> Iterable[str]: ...
    def insert_companies(self, rows: list[dict[str, Any]]) -> None: ...
    def update_company(self, company_id: str, fields: dict[str, Any]) -> None: ...


Checker = Callable[[str, str], tuple[bool, str | None, int]]  # (ats, slug) -> (live, name, jobs)


def live_check(ats: str, slug: str, http: Any) -> tuple[bool, str | None, int]:
    try:
        raws = EMPLOYER_SOURCES[ats].fetch_company(http, Company("check", slug, ats, slug))
    except Exception:  # noqa: BLE001 - not live
        return False, None, 0
    name = raws[0].company_name if raws and raws[0].company_name not in (None, slug) else None
    return bool(raws), name, len(raws)


def pretty_name(slug: str) -> str:
    bare = slug.removeprefix("eu:")
    return bare.replace("-", " ").replace("_", " ").title() if bare.islower() else bare


# ---------------------------------------------------------------- Common Crawl


class CommonCrawl:
    """Reads the public Common Crawl URL index. Gentle: one request at a time with pauses."""

    def __init__(self, crawls: int = 2, max_pages: int = 10, pause: float = 2.0):
        self.client = httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=120)
        self.crawls = crawls
        self.max_pages = max_pages
        self.pause = pause

    def _get(self, url: str, params: dict[str, Any]) -> httpx.Response | None:
        for attempt in range(4):
            try:
                res = self.client.get(url, params=params)
                if res.status_code == 200:
                    return res
                if res.status_code == 404:  # no captures for this pattern
                    return None
            except httpx.HTTPError:
                pass
            time.sleep(self.pause * (2**attempt))
        return None

    def indexes(self) -> list[str]:
        res = self._get("https://index.commoncrawl.org/collinfo.json", {})
        if not res:
            return []
        return [c["cdx-api"] for c in res.json()[: self.crawls]]

    def urls(self, pattern: str) -> Iterable[str]:
        for api in self.indexes():
            info = self._get(api, {"url": pattern, "showNumPages": "true"})
            pages = (info.json().get("pages", 0) if info else 0) or 0
            for page in range(min(pages, self.max_pages)):
                res = self._get(api, {"url": pattern, "output": "json", "fl": "url", "page": page})
                time.sleep(self.pause)
                if not res:
                    continue
                for line in res.text.splitlines():
                    if not line.startswith("{"):
                        continue
                    try:
                        yield json.loads(line).get("url", "")
                    except json.JSONDecodeError:
                        continue  # a truncated line in a large response; skip it


# ---------------------------------------------------------------- discovery run


@dataclass
class DiscoveryReport:
    candidates: dict[str, int] = field(default_factory=dict)
    checked: int = 0
    added: dict[str, int] = field(default_factory=dict)
    deactivated: int = 0
    reactivated: int = 0


def discover(
    store: DiscoveryStore,
    checker: Checker,
    common_crawl: CommonCrawl | None,
    now: datetime | None = None,
) -> DiscoveryReport:
    now = now or datetime.now(UTC)
    report = DiscoveryReport()
    known = store.companies()
    known_keys = {(c.ats, c.slug.lower()) for c in known}

    # 1. Candidates.
    found: dict[tuple[str, str], str] = {}
    for text in store.job_link_texts():
        for key in slugs_in(text):
            found.setdefault(key, "job_links")
    if common_crawl:
        for ats, patterns in CC_PATTERNS.items():
            for pattern in patterns:
                for url in common_crawl.urls(pattern):
                    for key in slugs_in(url):
                        if key[0] == ats:
                            found.setdefault(key, "common_crawl")
    new = {k: v for k, v in found.items() if (k[0], k[1].lower()) not in known_keys}
    for ats, _ in new:
        report.candidates[ats] = report.candidates.get(ats, 0) + 1

    # 2. Check new candidates and inactive companies due a monthly retry.
    retry = [
        c
        for c in known
        if not c.active and (c.checked_at is None or now - c.checked_at >= RECHECK_INACTIVE_AFTER)
    ]
    to_check = list(new.items())[:MAX_NEW_CHECKS]
    with ThreadPoolExecutor(CHECK_CONCURRENCY) as pool:
        new_results = list(pool.map(lambda kv: (kv, checker(*kv[0])), to_check))
        retry_results = list(pool.map(lambda c: (c, checker(c.ats, c.slug)), retry))
    report.checked = len(new_results) + len(retry_results)

    rows = []
    for ((ats, slug), via), (live, name, jobs) in new_results:
        if live:
            rows.append(
                {
                    "ats": ats,
                    "slug": slug,
                    "name": name or pretty_name(slug),
                    "active": True,
                    "discovered_via": via,
                    "checked_at": now.isoformat(),
                    "jobs_open": jobs,
                }
            )
            report.added[ats] = report.added.get(ats, 0) + 1
    if rows:
        store.insert_companies(rows)

    for company, (live, _, jobs) in retry_results:
        fields: dict[str, Any] = {"checked_at": now.isoformat()}
        if live:
            fields |= {"active": True, "fail_count": 0, "jobs_open": jobs, "last_error": None}
            report.reactivated += 1
        store.update_company(company.id, fields)

    # 3. Deactivate companies whose fetch failed 5 runs in a row.
    for c in known:
        if c.active and c.fail_count >= FAILS_BEFORE_DEACTIVATE:
            store.update_company(c.id, {"active": False, "checked_at": now.isoformat()})
            report.deactivated += 1

    return report
