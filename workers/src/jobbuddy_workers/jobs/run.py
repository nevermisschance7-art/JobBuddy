"""One fetch run: every employer system, then the aggregators that are due this run."""

from __future__ import annotations

import logging
from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from ..embed import Embedder, job_text, to_pgvector
from ..geo import region_covers
from ..http import Http
from .model import Job, RawJob
from .normalize import content_hash, dedupe_key, is_tech_role
from .sources import AGGREGATOR_SOURCES, EMPLOYER_SOURCES, Company, FetchContext
from .store import Existing, JobStore

log = logging.getLogger(__name__)

EMPLOYER_CONCURRENCY = 16  # parallel companies per employer system (public, cached board APIs)
MAX_AGE_DAYS = 45  # older postings are rarely still worth applying to; keeps the free DB small
AGGREGATOR_STALE_DAYS = 14  # aggregator jobs close when not seen for this long


@dataclass
class SourceStats:
    seen: int = 0
    new: int = 0
    updated: int = 0
    closed: int = 0
    errors: list[str] = field(default_factory=list)


@dataclass
class RunState:
    """Dedupe state shared across sources within one run."""

    keys: dict[str, str]  # dedupe_key -> source that owns it
    urls: set[str]


def is_relevant(job: Job, wanted: set[str], now: datetime | None = None) -> bool:
    """Recent tech roles that at least one user could take. With no users yet, remote only."""
    if not is_tech_role(job.title):
        return False
    now = now or datetime.now(UTC)
    if job.posted_at and now - job.posted_at > timedelta(days=MAX_AGE_DAYS):
        return False
    if not wanted:
        return job.remote_type == "remote"
    if wanted & set(job.countries):
        return True
    if any(region_covers(r, c) for r in job.remote_regions for c in wanted):
        return True
    # Remote with no stated area: keep; the matcher marks eligibility as unclear.
    return job.remote_type == "remote" and not job.countries and not job.remote_regions


def job_row(job: Job, h: str, key: str, embedding: list[float] | None) -> dict[str, Any]:
    row: dict[str, Any] = {
        "source": job.source,
        "external_id": job.external_id,
        "canonical_url": job.canonical_url,
        "apply_url": job.apply_url,
        "title": job.title[:300],
        "company_id": job.company_id,
        "company_name": job.company_name[:200],
        "locations": job.locations,
        "countries": job.countries,
        "remote_regions": job.remote_regions,
        "remote_type": job.remote_type,
        "employment_type": job.employment_type,
        "seniority": job.seniority,
        "salary_min": job.salary_min,
        "salary_max": job.salary_max,
        "salary_currency": job.salary_currency,
        "description_text": job.description_text,
        "posted_at": job.posted_at.isoformat() if job.posted_at else None,
        "date_source": job.date_source,
        "source_updated_at": job.source_updated_at.isoformat() if job.source_updated_at else None,
        "tags": [t[:50] for t in job.tags[:30]],
        "content_hash": h,
        "dedupe_key": key,
        "last_seen_at": datetime.now(UTC).isoformat(),
        # Only written for new or changed jobs; the matcher scores jobs changed since its last run.
        "content_updated_at": datetime.now(UTC).isoformat(),
        "missed_runs": 0,
        "closed_at": None,
    }
    if embedding is not None:
        row["embedding"] = to_pgvector(embedding)
    return row


def job_hash(job: Job) -> str:
    return content_hash(
        job.title, job.company_name, job.countries, job.remote_regions, job.remote_type,
        job.description_text, job.salary_min, job.salary_max, job.posted_at, job.apply_url,
    )  # fmt: skip


class Runner:
    def __init__(self, store: JobStore, http: Http, embedder: Embedder, env: dict[str, str]):
        self.store = store
        self.http = http
        self.embedder = embedder
        self.env = env

    def run(
        self, only: Iterable[str] | None = None, hour: int | None = None
    ) -> dict[str, SourceStats]:
        only_set = set(only or [])
        hour = datetime.now(UTC).hour if hour is None else hour
        wanted = self.store.wanted_countries()
        ctx = FetchContext(wanted_countries=wanted, env=self.env)
        keys, urls = self.store.open_keys()
        state = RunState(keys=keys, urls=urls)
        results: dict[str, SourceStats] = {}

        for name, src in EMPLOYER_SOURCES.items():
            if only_set and name not in only_set:
                continue
            results[name] = self._run_employer(src, ctx, state)

        for name, src in AGGREGATOR_SOURCES.items():
            if only_set and name not in only_set:
                continue
            due = only_set or hour % src.every_hours == 0
            if not due or not src.available(ctx):
                continue
            results[name] = self._run_aggregator(src, ctx, state)
        return results

    # ------------------------------------------------------------ employer systems

    def _run_employer(self, src: Any, ctx: FetchContext, state: RunState) -> SourceStats:
        stats = SourceStats()
        run_id = self.store.start_run(src.name)
        companies = self.store.active_companies(src.name)
        existing = self.store.existing(src.name)

        def fetch(company: Company) -> tuple[Company, list[RawJob] | None, str | None]:
            try:
                return company, src.fetch_company(self.http, company), None
            except Exception as e:  # noqa: BLE001 - one company failing must not stop the run
                return company, None, f"{company.slug}: {e}"[:300]

        with ThreadPoolExecutor(EMPLOYER_CONCURRENCY) as pool:
            fetched = list(pool.map(fetch, companies))

        ok_companies: set[str] = set()
        seen_external: set[str] = set()
        jobs: list[Job] = []
        for company, raws, error in fetched:
            if raws is None:
                stats.errors.append(error or "unknown error")
                self.store.company_result(company.id, False, 0, error)
                continue
            ok_companies.add(company.id)
            stats.seen += len(raws)
            seen_external |= {r.external_id for r in raws}
            if hasattr(src, "fetch_detail"):
                wants = getattr(src, "wants_detail", lambda _r: True)
                raws = [
                    src.fetch_detail(self.http, r)
                    if r.external_id not in existing and wants(r)
                    else r
                    for r in raws
                ]
            company_jobs = self._normalise_all(src, raws, ctx, stats)
            jobs += company_jobs
            self.store.company_result(company.id, True, len(company_jobs), None)

        self._store(jobs, existing, state, stats)

        # Complete listings: a stored job missing from its company's successful listing.
        missing = [
            e.id
            for e in existing.values()
            if not e.closed and e.company_id in ok_companies and e.external_id not in seen_external
        ]
        stats.closed += self.store.mark_missed(missing) if missing else 0
        self.store.finish_run(
            run_id, stats.seen, stats.new, stats.updated, stats.closed, stats.errors
        )
        log.info("%s: %s", src.name, stats)
        return stats

    # ------------------------------------------------------------ aggregators

    def _run_aggregator(self, src: Any, ctx: FetchContext, state: RunState) -> SourceStats:
        stats = SourceStats()
        run_id = self.store.start_run(src.name)
        try:
            raws = src.fetch(self.http, ctx)
        except Exception as e:  # noqa: BLE001
            stats.errors.append(str(e)[:300])
            raws = []
        stats.seen = len(raws)
        existing = self.store.existing(src.name)
        jobs = self._normalise_all(src, raws, ctx, stats)
        self._store(jobs, existing, state, stats)
        stats.closed += self.store.close_stale(src.name, AGGREGATOR_STALE_DAYS)
        self.store.finish_run(
            run_id, stats.seen, stats.new, stats.updated, stats.closed, stats.errors
        )
        log.info("%s: %s", src.name, stats)
        return stats

    # ------------------------------------------------------------ shared

    def _normalise_all(
        self, src: Any, raws: list[RawJob], ctx: FetchContext, stats: SourceStats
    ) -> list[Job]:
        out = []
        for raw in raws:
            try:
                job = src.normalise(raw)
            except Exception as e:  # noqa: BLE001 - one odd posting must not stop the run
                stats.errors.append(f"normalise {raw.external_id}: {e}"[:300])
                continue
            if job and raw.company_id and not job.company_id:
                job.company_id = raw.company_id
            if job and is_relevant(job, ctx.wanted_countries):
                out.append(job)
        return out

    def _store(
        self, jobs: list[Job], existing: dict[str, Existing], state: RunState, stats: SourceStats
    ) -> None:
        to_embed: list[tuple[Job, str, str]] = []
        unchanged: list[str] = []
        for job in jobs:
            key = dedupe_key(job.company_name, job.title, job.countries)
            owner = state.keys.get(key)
            known = existing.get(job.external_id)
            # Another source already has this job (employer systems run first, so they win).
            if not known and ((owner and owner != job.source) or job.canonical_url in state.urls):
                continue
            state.keys.setdefault(key, job.source)
            state.urls.add(job.canonical_url)

            h = job_hash(job)
            if known and known.content_hash == h:
                unchanged.append(known.id)
            else:
                to_embed.append((job, h, key))
                if known:
                    stats.updated += 1
                else:
                    stats.new += 1

        if unchanged:
            self.store.mark_seen(unchanged)
        for i in range(0, len(to_embed), 64):
            batch = to_embed[i : i + 64]
            vectors = self.embedder.embed(
                [job_text(j.title, j.company_name, j.description_text) for j, _, _ in batch]
            )
            self.store.upsert_jobs(
                [job_row(j, h, k, v) for (j, h, k), v in zip(batch, vectors, strict=True)]
            )
