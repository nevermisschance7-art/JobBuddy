"""Scores new or changed jobs for every user with a confirmed CV. No AI calls.

Per user: a full rescore when their CV or filters changed since the last full match,
otherwise only jobs whose content changed since the last matcher run. Stores every job
that passes the filters (any score), plus near misses that failed a filter but would have
scored at least min_score, so the app can say why they were hidden.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta, tzinfo
from typing import Any, Protocol
from zoneinfo import ZoneInfo

from ..embed import Embedder
from .cv import cv_skills, cv_text
from .rules import JobFacts, Result, UserFilters, evaluate, is_hot, top_reasons

log = logging.getLogger(__name__)

MAX_HOT_PER_DAY = 3
MIN_STORED_SCORE = 30  # passing jobs below this are noise; never shown at any sensible setting


@dataclass
class UserContext:
    user_id: str
    min_score: int
    time_zone: str
    alert_settings: dict[str, Any]
    matched_at: datetime | None
    filters: UserFilters
    filters_updated_at: datetime
    cv_id: str
    resume: dict[str, Any]
    # None when the CV was confirmed or edited since the last match (the web app clears it).
    cv_embedding: list[float] | None


class MatchStore(Protocol):
    def users(self) -> list[UserContext]: ...
    def save_cv_embedding(self, cv_id: str, embedding: list[float]) -> None: ...
    def jobs(self, cv_embedding: list[float], since: datetime) -> list[JobFacts]: ...
    def save_matches(self, user_id: str, rows: list[dict[str, Any]]) -> None: ...
    def remove_matches(self, user_id: str, job_ids: list[str]) -> None: ...
    def set_matched_at(self, user_id: str, when: datetime) -> None: ...
    def last_run_started(self) -> datetime | None: ...
    def start_run(self, source: str) -> str: ...
    def finish_run(
        self, run_id: str, seen: int, new: int, updated: int, closed: int, errors: list[str]
    ) -> None: ...
    def events_today(self, user_id: str, event_type: str, since: datetime) -> int: ...
    def unsummarised_count(self, user_id: str, since: datetime, min_score: int) -> int: ...
    def last_event_at(self, user_id: str, event_type: str) -> datetime | None: ...
    def add_event(self, user_id: str, event_type: str, payload: dict[str, Any]) -> None: ...


@dataclass
class MatchReport:
    users: int = 0
    jobs_scored: int = 0
    stored: int = 0
    hot: int = 0
    summaries: int = 0
    errors: list[str] = field(default_factory=list)


def _zone(tz: str) -> tzinfo:
    try:
        return ZoneInfo(tz)
    except Exception:  # noqa: BLE001 - unknown zone names fall back to UTC
        return UTC


def _local_midnight(now: datetime, tz: str) -> datetime:
    local = now.astimezone(_zone(tz))
    return local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(UTC)


def _local_time_reached(now: datetime, tz: str, hhmm: str) -> bool:
    try:
        h, m = (int(x) for x in hhmm.split(":"))
    except ValueError:
        h, m = 9, 0
    local = now.astimezone(_zone(tz))
    return (local.hour, local.minute) >= (h, m)


def _enabled(user: UserContext, event_type: str) -> bool:
    enabled = user.alert_settings.get("enabled_types")
    return enabled is None or event_type in enabled


def match_row(user_id: str, job: JobFacts, result: Result) -> dict[str, Any]:
    return {
        "user_id": user_id,
        "job_id": job.id,
        "score": result.score,
        "breakdown": {**result.breakdown, "top_reasons": top_reasons(result)},
        "passed_filters": result.passed,
        "reasons_failed": result.reasons_failed,
    }


def run_matcher(store: MatchStore, embedder: Embedder, now: datetime | None = None) -> MatchReport:
    now = now or datetime.now(UTC)
    report = MatchReport()
    run_id = store.start_run("matcher")
    last_run = store.last_run_started()

    for user in store.users():
        report.users += 1
        try:
            _match_user(store, embedder, user, last_run, now, report)
        except Exception as e:  # noqa: BLE001 - one user's problem must not stop the others
            log.exception("matching failed for %s", user.user_id)
            report.errors.append(f"{user.user_id}: {e}"[:300])

    store.finish_run(run_id, report.jobs_scored, report.stored, 0, 0, report.errors)
    return report


def _match_user(
    store: MatchStore,
    embedder: Embedder,
    user: UserContext,
    last_run: datetime | None,
    now: datetime,
    report: MatchReport,
) -> None:
    embedding = user.cv_embedding
    cv_changed = embedding is None or user.matched_at is None
    if embedding is None:
        embedding = embedder.embed([cv_text(user.resume)])[0]
        store.save_cv_embedding(user.cv_id, embedding)

    user.filters.cv_skills = cv_skills(user.resume)
    full = cv_changed or user.filters_updated_at > (
        user.matched_at or datetime.min.replace(tzinfo=UTC)
    )
    # Small overlap so a job stored while the last run was in progress is not missed.
    since = (
        datetime(2000, 1, 1, tzinfo=UTC)
        if full or last_run is None
        else last_run - timedelta(minutes=10)
    )

    jobs = store.jobs(embedding, since)
    report.jobs_scored += len(jobs)
    keep: list[dict[str, Any]] = []
    drop: list[str] = []
    hot: list[tuple[JobFacts, Result]] = []
    for job in jobs:
        result = evaluate(job, user.filters, now)
        visible = result.passed and result.score >= MIN_STORED_SCORE
        near_miss = not result.passed and result.score >= user.min_score
        if visible or near_miss:
            keep.append(match_row(user.user_id, job, result))
        else:
            drop.append(job.id)
        if result.score >= user.min_score and is_hot(result, job, now):
            hot.append((job, result))

    if keep:
        store.save_matches(user.user_id, keep)
    if drop:
        store.remove_matches(user.user_id, drop)
    report.stored += len(keep)
    if full:
        store.set_matched_at(user.user_id, now)

    _hot_events(store, user, hot, now, report)
    _daily_summary(store, user, now, report)


def _hot_events(
    store: MatchStore,
    user: UserContext,
    hot: list[tuple[JobFacts, Result]],
    now: datetime,
    report: MatchReport,
) -> None:
    if not hot or not _enabled(user, "hot_match"):
        return
    today = _local_midnight(now, user.time_zone)
    room = MAX_HOT_PER_DAY - store.events_today(user.user_id, "hot_match", today)
    for job, result in sorted(hot, key=lambda h: h[1].score, reverse=True)[: max(0, room)]:
        store.add_event(
            user.user_id,
            "hot_match",
            {
                "job_id": job.id,
                "title": job.title,
                "company": job.company_name,
                "score": result.score,
            },
        )
        report.hot += 1


def _daily_summary(
    store: MatchStore, user: UserContext, now: datetime, report: MatchReport
) -> None:
    if not _enabled(user, "daily_summary"):
        return
    when = str(user.alert_settings.get("daily_summary_time") or "09:00")
    if not _local_time_reached(now, user.time_zone, when):
        return
    today = _local_midnight(now, user.time_zone)
    if store.events_today(user.user_id, "daily_summary", today):
        return
    since = store.last_event_at(user.user_id, "daily_summary") or now - timedelta(days=1)
    count = store.unsummarised_count(user.user_id, since, user.min_score)
    store.add_event(
        user.user_id, "daily_summary", {"new_matches": count, "since": since.isoformat()}
    )
    report.summaries += 1
