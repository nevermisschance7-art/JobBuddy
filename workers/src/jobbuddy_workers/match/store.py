"""Supabase access for the matcher (service role)."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from ..embed import to_pgvector
from ..jobs.normalize import from_iso
from ..jobs.store import SupabaseStore
from .rules import JobFacts, UserFilters
from .run import UserContext

_EPOCH = datetime(2000, 1, 1, tzinfo=UTC)


def _vector(value: Any) -> list[float] | None:
    if value is None:
        return None
    return json.loads(value) if isinstance(value, str) else list(value)


class SupabaseMatchStore(SupabaseStore):
    def users(self) -> list[UserContext]:
        cvs = self._get_all(
            "cvs",
            {
                "select": "id,user_id,resume_json,embedding,updated_at",
                "confirmed": "is.true",
                "order": "created_at.desc",
            },
        )
        latest: dict[str, dict[str, Any]] = {}
        for cv in cvs:
            latest.setdefault(cv["user_id"], cv)
        if not latest:
            return []
        ids = ",".join(latest)
        profiles = {
            p["user_id"]: p
            for p in self._get_all(
                "profiles",
                {
                    "select": "user_id,min_score,time_zone,alert_settings,matched_at",
                    "user_id": f"in.({ids})",
                },
            )
        }
        filters = {
            f["user_id"]: f
            for f in self._get_all("filters", {"select": "*", "user_id": f"in.({ids})"})
        }
        out = []
        for user_id, cv in latest.items():
            p, f = profiles.get(user_id), filters.get(user_id)
            if not p or not f:
                continue
            out.append(
                UserContext(
                    user_id=user_id,
                    min_score=p["min_score"],
                    time_zone=p["time_zone"] or "UTC",
                    alert_settings=p["alert_settings"] or {},
                    matched_at=from_iso(p["matched_at"]),
                    filters=UserFilters(
                        countries_allowed=f["countries_allowed"] or [],
                        needs_sponsorship=f["needs_sponsorship"],
                        remote_types=f["remote_types"] or ["remote", "hybrid", "onsite"],
                        hybrid_max_office_days=f["hybrid_max_office_days"],
                        seniority_levels=f["seniority_levels"] or [],
                        must_have_skills=f["must_have_skills"] or [],
                        excluded_skills=f["excluded_skills"] or [],
                        excluded_companies=f["excluded_companies"] or [],
                        salary_floor=float(f["salary_floor"]) if f["salary_floor"] else None,
                        salary_currency=f["salary_currency"],
                        employment_types=f["employment_types"] or ["full_time"],
                    ),
                    filters_updated_at=from_iso(f["updated_at"]) or _EPOCH,
                    cv_id=cv["id"],
                    resume=cv["resume_json"] or {},
                    cv_embedding=_vector(cv["embedding"]),
                )
            )
        return out

    def save_cv_embedding(self, cv_id: str, embedding: list[float]) -> None:
        self.client.patch(
            f"{self.rest}/cvs",
            params={"id": f"eq.{cv_id}"},
            json={"embedding": to_pgvector(embedding)},
        ).raise_for_status()

    def jobs(self, cv_embedding: list[float], since: datetime) -> list[JobFacts]:
        out: list[JobFacts] = []
        offset = 0
        while True:
            rows = (
                self._rpc(
                    "jobs_for_matching",
                    {
                        "p_cv": to_pgvector(cv_embedding),
                        "p_since": since.isoformat(),
                        "p_limit": 1000,
                        "p_offset": offset,
                    },
                )
                or []
            )
            for r in rows:
                out.append(
                    JobFacts(
                        id=r["id"],
                        title=r["title"],
                        company_name=r["company_name"],
                        countries=r["countries"] or [],
                        remote_regions=r["remote_regions"] or [],
                        remote_type=r["remote_type"],
                        employment_type=r["employment_type"],
                        seniority=r["seniority"],
                        description_text=r["description_text"] or "",
                        posted_at=from_iso(r["posted_at"]),
                        similarity=float(r["similarity"] or 0),
                        salary_min=float(r["salary_min"]) if r["salary_min"] is not None else None,
                        salary_max=float(r["salary_max"]) if r["salary_max"] is not None else None,
                        salary_currency=r["salary_currency"],
                        tags=r["tags"] or [],
                    )
                )
            if len(rows) < 1000:
                return out
            offset += 1000

    def save_matches(self, user_id: str, rows: list[dict[str, Any]]) -> None:
        # status is not sent, so a job the user saved or dismissed keeps its status.
        for i in range(0, len(rows), 500):
            self.client.post(
                f"{self.rest}/user_job_matches",
                params={"on_conflict": "user_id,job_id"},
                headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
                json=rows[i : i + 500],
            ).raise_for_status()

    def remove_matches(self, user_id: str, job_ids: list[str]) -> None:
        # Only untouched matches; anything the user acted on stays.
        for i in range(0, len(job_ids), 200):
            chunk = ",".join(job_ids[i : i + 200])
            self.client.delete(
                f"{self.rest}/user_job_matches",
                params={
                    "user_id": f"eq.{user_id}",
                    "job_id": f"in.({chunk})",
                    "status": "in.(new,seen)",
                },
            ).raise_for_status()

    def set_matched_at(self, user_id: str, when: datetime) -> None:
        self.client.patch(
            f"{self.rest}/profiles",
            params={"user_id": f"eq.{user_id}"},
            json={"matched_at": when.isoformat()},
        ).raise_for_status()

    def last_run_started(self) -> datetime | None:
        res = self.client.get(
            f"{self.rest}/source_runs",
            params={
                "select": "started_at",
                "source": "eq.matcher",
                "finished_at": "not.is.null",
                "order": "started_at.desc",
                "limit": "1",
            },
        )
        res.raise_for_status()
        rows = res.json()
        return from_iso(rows[0]["started_at"]) if rows else None

    def _count(self, table: str, params: dict[str, str]) -> int:
        res = self.client.get(
            f"{self.rest}/{table}",
            params={**params, "select": "id", "limit": "1"},
            headers={"Prefer": "count=exact"},
        )
        res.raise_for_status()
        return int(res.headers.get("content-range", "*/0").split("/")[-1] or 0)

    def events_today(self, user_id: str, event_type: str, since: datetime) -> int:
        return self._count(
            "events",
            {
                "user_id": f"eq.{user_id}",
                "type": f"eq.{event_type}",
                "created_at": f"gte.{since.isoformat()}",
            },
        )

    def unsummarised_count(self, user_id: str, since: datetime, min_score: int) -> int:
        return self._count(
            "user_job_matches",
            {
                "user_id": f"eq.{user_id}",
                "passed_filters": "is.true",
                "score": f"gte.{min_score}",
                "created_at": f"gte.{since.isoformat()}",
            },
        )

    def last_event_at(self, user_id: str, event_type: str) -> datetime | None:
        res = self.client.get(
            f"{self.rest}/events",
            params={
                "select": "created_at",
                "user_id": f"eq.{user_id}",
                "type": f"eq.{event_type}",
                "order": "created_at.desc",
                "limit": "1",
            },
        )
        res.raise_for_status()
        rows = res.json()
        return from_iso(rows[0]["created_at"]) if rows else None

    def add_event(self, user_id: str, event_type: str, payload: dict[str, Any]) -> None:
        self.client.post(
            f"{self.rest}/events",
            headers={"Prefer": "return=minimal"},
            json={"user_id": user_id, "type": event_type, "payload": payload},
        ).raise_for_status()
