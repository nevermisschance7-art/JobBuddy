"""Verify candidate companies and insert the live ones.

A candidate is live when its employer-system board returns at least one job. Runs in
GitHub Actions (workflow "Seed companies"), where the network is fast.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor

import httpx

from ..http import Http
from ..jobs.sources import EMPLOYER_SOURCES, Company
from .candidates import CANDIDATES

log = logging.getLogger(__name__)


def _check(http: Http, ats: str, slug: str) -> tuple[str, str, str, int]:
    src = EMPLOYER_SOURCES[ats]
    try:
        raws = src.fetch_company(http, Company("check", slug, ats, slug))
    except Exception:  # noqa: BLE001 - not live
        return ats, slug, slug, 0
    name = (raws[0].company_name if raws and raws[0].company_name != slug else None) or slug
    return ats, slug, name, len(raws)


def _pretty(slug: str) -> str:
    return slug.replace("-", " ").replace("_", " ").title() if slug.islower() else slug


def seed(url: str, service_key: str, dry_run: bool = False) -> int:
    http = Http(retries=1)
    pairs = [(ats, slug) for ats, slugs in CANDIDATES.items() for slug in dict.fromkeys(slugs)]
    with ThreadPoolExecutor(8) as pool:
        results = list(pool.map(lambda p: _check(http, *p), pairs))
    http.close()

    live = [r for r in results if r[3] > 0]
    by_ats: dict[str, int] = {}
    for ats, *_ in live:
        by_ats[ats] = by_ats.get(ats, 0) + 1
    print(f"{len(live)} of {len(pairs)} candidates are live: {by_ats}")
    for ats, slug, _, n in sorted(live):
        log.info("live %s/%s (%d jobs)", ats, slug, n)
    if dry_run:
        return 0

    rows = [
        {"ats": ats, "slug": slug, "name": name if name != slug else _pretty(slug), "active": True}
        for ats, slug, name, _ in live
    ]
    res = httpx.post(
        f"{url.rstrip('/')}/rest/v1/companies",
        params={"on_conflict": "ats,slug"},
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        json=rows,
        timeout=60,
    )
    res.raise_for_status()
    print(f"Inserted or updated {len(rows)} companies.")
    return 0
