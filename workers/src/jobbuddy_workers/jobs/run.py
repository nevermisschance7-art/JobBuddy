"""One fetch run: every employer system, then the aggregators that are due this run."""

from __future__ import annotations

import logging
import threading
from collections import Counter
from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlsplit

from ..embed import Embedder, job_text, to_pgvector
from ..http import Http
from .model import Job, RawJob
from .normalize import MAX_DESCRIPTION_CHARS, content_hash, dedupe_key, is_tech_role
from .sources import AGGREGATOR_SOURCES, EMPLOYER_SOURCES, Company, FetchContext
from .store import Existing, JobStore

log = logging.getLogger(__name__)

EMPLOYER_CONCURRENCY = 16  # parallel companies per employer system (public, cached board APIs)
MAX_DETAILS_PER_RUN = (
    400  # detail requests (SmartRecruiters) per run; the rest wait for the next run
)
# Only fresh remote jobs are stored: posted in the last 48 hours (kept 4 days by prune_stale_jobs).
MAX_AGE_DAYS = 7  # store jobs posted within this many days (kept 10 days, see prune_stale_jobs)
# Apply links that lead to a marketplace you must join and be vetted by, not to the employer.
MARKETPLACE_HOSTS = ("lemon.io",)
AGGREGATOR_STALE_DAYS = 14  # aggregator jobs close when not seen for this long


@dataclass
class SourceStats:
    seen: int = 0
    new: int = 0
    updated: int = 0
    closed: int = 0
    errors: list[str] = field(default_factory=list)
    # Why listed jobs were not stored: too_old, no_date, not_remote, not_tech.
    dropped: Counter[str] = field(default_factory=Counter)


@dataclass
class RunState:
    """Dedupe state shared across sources within one run."""

    keys: dict[str, str]  # dedupe_key -> source that owns it
    urls: set[str]


def is_recent(posted_at: datetime | None, now: datetime | None = None) -> bool:
    """Posted in the last 7 days. Jobs without a real posting date can't prove that."""
    if posted_at is None:
        return False
    now = now or datetime.now(UTC)
    return now - posted_at <= timedelta(days=MAX_AGE_DAYS)


def _host_in(url: str | None, hosts: tuple[str, ...]) -> bool:
    host = (urlsplit(url or "").hostname or "").lower()
    return any(host == h or host.endswith("." + h) for h in hosts)


def drop_reason(job: Job, now: datetime | None = None) -> str | None:
    """Why a job is not stored, or None when it is kept."""
    if not is_tech_role(job.title):
        return "not_tech"
    if job.remote_type != "remote":
        return "not_remote"
    if _host_in(job.apply_url, MARKETPLACE_HOSTS) or _host_in(job.canonical_url, MARKETPLACE_HOSTS):
        return "marketplace"
    if job.posted_at is None:
        return "no_date"
    if not is_recent(job.posted_at, now):
        return "too_old"
    return None


def is_relevant(job: Job, wanted: set[str] | None = None, now: datetime | None = None) -> bool:
    """Fresh remote tech jobs, from anywhere. Whether a user may take one (their countries,
    remote_extra_countries) is decided by the matcher, not here."""
    return drop_reason(job, now) is None


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
            results[name] = self._guarded(name, lambda s=src: self._run_employer(s, ctx, state))

        for name, src in AGGREGATOR_SOURCES.items():
            if only_set and name not in only_set:
                continue
            due = only_set or hour % src.every_hours == 0
            if not due or not src.available(ctx):
                continue
            results[name] = self._guarded(name, lambda s=src: self._run_aggregator(s, ctx, state))
        return results

    def _guarded(self, name: str, run: Any) -> SourceStats:
        """One source crashing must not stop the others (or matching afterwards)."""
        try:
            return run()
        except Exception as e:  # noqa: BLE001
            log.exception("source %s crashed", name)
            return SourceStats(errors=[f"crashed: {e}"[:300]])

    # ------------------------------------------------------------ employer systems

    def _run_employer(self, src: Any, ctx: FetchContext, state: RunState) -> SourceStats:
        stats = SourceStats()
        run_id = self.store.start_run(src.name)
        companies = self.store.active_companies(src.name)
        existing = self.store.existing(src.name)

        listed_ids: dict[str, set[str]] = {}
        details_left = [MAX_DETAILS_PER_RUN]
        lock = threading.Lock()

        def take_detail_slot() -> bool:
            with lock:
                if details_left[0] <= 0:
                    return False
                details_left[0] -= 1
                return True

        def with_details(raws: list[RawJob]) -> list[RawJob]:
            """Fetch details only for unseen jobs we would keep. Over budget: skip for now
            (they are not stored, so the next run still sees them as new)."""
            if not hasattr(src, "fetch_detail"):
                return raws
            wants = getattr(src, "wants_detail", lambda _r: True)
            out = []
            for r in raws:
                if r.external_id in existing or not wants(r):
                    out.append(r)
                    continue
                # Sources whose list lacks location (Workday) decide from the list item itself.
                prefilter = getattr(src, "prefilter", None)
                if prefilter is not None:
                    if not prefilter(r):
                        continue
                else:
                    draft = src.normalise(r)
                    reason = "unreadable" if draft is None else drop_reason(draft)
                    if reason:
                        with lock:
                            stats.dropped[reason] += 1
                        continue
                if take_detail_slot():
                    out.append(src.fetch_detail(self.http, r))
            return out

        def fetch(company: Company) -> tuple[Company, list[RawJob] | None, int, str | None]:
            try:
                raws = src.fetch_company(self.http, company)
                listed_ids[company.id] = {r.external_id for r in raws}
                return company, with_details(raws), len(raws), None
            except Exception as e:  # noqa: BLE001 - one company failing must not stop the run
                return company, None, 0, f"{company.slug}: {e}"[:300]

        with ThreadPoolExecutor(EMPLOYER_CONCURRENCY) as pool:
            fetched = list(pool.map(fetch, companies))

        ok_companies: set[str] = set()
        seen_external: set[str] = set()
        jobs: list[Job] = []
        results: list[dict[str, Any]] = []
        for company, raws, listed, error in fetched:
            if raws is None:
                stats.errors.append(error or "unknown error")
                results.append({"id": company.id, "ok": False, "jobs_open": 0, "error": error})
                continue
            ok_companies.add(company.id)
            stats.seen += listed
            seen_external |= listed_ids.get(company.id, set())
            company_jobs = self._normalise_all(src, raws, ctx, stats)
            jobs += company_jobs
            results.append(
                {"id": company.id, "ok": True, "jobs_open": len(company_jobs), "error": None}
            )
        self.store.company_results(results)

        self._store(jobs, existing, state, stats)

        # Complete listings: a stored job missing from its company's successful listing.
        # (Workday is paged by recency, so its listing is partial and absence proves nothing.)
        complete = getattr(src, "complete_listing", True)
        missing = [
            e.id
            for e in existing.values()
            if complete
            and not e.closed
            and e.company_id in ok_companies
            and e.external_id not in seen_external
        ]
        stats.closed += self.store.mark_missed(missing) if missing else 0
        self.store.finish_run(
            run_id,
            stats.seen,
            stats.new,
            stats.updated,
            stats.closed,
            stats.errors,
            dict(stats.dropped),
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
            run_id,
            stats.seen,
            stats.new,
            stats.updated,
            stats.closed,
            stats.errors,
            dict(stats.dropped),
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
            if job:
                job.description_text = job.description_text[:MAX_DESCRIPTION_CHARS]
            if job and raw.company_id and not job.company_id:
                job.company_id = raw.company_id
            reason = "unreadable" if job is None else drop_reason(job)
            if reason:
                stats.dropped[reason] += 1
            else:
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
            stats.errors += self.store.upsert_jobs(
                [job_row(j, h, k, v) for (j, h, k), v in zip(batch, vectors, strict=True)]
            )
