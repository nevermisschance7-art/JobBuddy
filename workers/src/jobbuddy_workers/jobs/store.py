"""Where jobs are stored. SupabaseStore talks to PostgREST with the service role key;
MemoryStore does the same in memory for tests."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

import httpx

from .sources.base import Company


@dataclass
class Existing:
    id: str
    external_id: str
    content_hash: str | None
    company_id: str | None
    closed: bool


class JobStore(Protocol):
    def wanted_countries(self) -> set[str]: ...
    def active_companies(self, ats: str) -> list[Company]: ...
    def existing(self, source: str) -> dict[str, Existing]: ...
    def open_keys(self) -> tuple[dict[str, str], set[str]]: ...
    def upsert_jobs(self, rows: list[dict[str, Any]]) -> None: ...
    def mark_seen(self, ids: list[str]) -> None: ...
    def mark_missed(self, ids: list[str]) -> int: ...
    def close_stale(self, source: str, days: int) -> int: ...
    def company_result(
        self, company_id: str, ok: bool, jobs_open: int, error: str | None
    ) -> None: ...
    def start_run(self, source: str) -> str: ...
    def finish_run(
        self, run_id: str, seen: int, new: int, updated: int, closed: int, errors: list[str]
    ) -> None: ...


def _chunks(items: list[Any], size: int) -> list[list[Any]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


class SupabaseStore:
    def __init__(self, url: str, service_key: str):
        self.rest = f"{url.rstrip('/')}/rest/v1"
        self.client = httpx.Client(
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Content-Type": "application/json",
            },
            timeout=60,
        )

    def _get_all(self, table: str, params: dict[str, str]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        offset = 0
        while True:
            res = self.client.get(
                f"{self.rest}/{table}", params={**params, "limit": "1000", "offset": str(offset)}
            )
            res.raise_for_status()
            page = res.json()
            out += page
            if len(page) < 1000:
                return out
            offset += 1000

    def _rpc(self, fn: str, body: dict[str, Any]) -> Any:
        res = self.client.post(f"{self.rest}/rpc/{fn}", json=body)
        res.raise_for_status()
        return res.json() if res.content else None

    def wanted_countries(self) -> set[str]:
        rows = self._get_all("filters", {"select": "countries_allowed"})
        return {c for r in rows for c in r.get("countries_allowed") or []}

    def active_companies(self, ats: str) -> list[Company]:
        rows = self._get_all(
            "companies", {"select": "id,name,ats,slug", "ats": f"eq.{ats}", "active": "is.true"}
        )
        return [Company(r["id"], r["name"], r["ats"], r["slug"]) for r in rows]

    def existing(self, source: str) -> dict[str, Existing]:
        rows = self._get_all(
            "jobs",
            {
                "select": "id,external_id,content_hash,company_id,closed_at",
                "source": f"eq.{source}",
            },
        )
        return {
            r["external_id"]: Existing(
                r["id"],
                r["external_id"],
                r["content_hash"],
                r["company_id"],
                r["closed_at"] is not None,
            )
            for r in rows
        }

    def open_keys(self) -> tuple[dict[str, str], set[str]]:
        since = (datetime.now(UTC) - timedelta(days=30)).isoformat()
        rows = self._get_all(
            "jobs",
            {
                "select": "source,dedupe_key,canonical_url",
                "closed_at": "is.null",
                "first_seen_at": f"gte.{since}",
            },
        )
        keys = {r["dedupe_key"]: r["source"] for r in rows if r.get("dedupe_key")}
        return keys, {r["canonical_url"] for r in rows}

    def upsert_jobs(self, rows: list[dict[str, Any]]) -> None:
        for chunk in _chunks(rows, 200):
            res = self.client.post(
                f"{self.rest}/jobs",
                params={"on_conflict": "source,external_id"},
                headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
                json=chunk,
            )
            res.raise_for_status()

    def mark_seen(self, ids: list[str]) -> None:
        for chunk in _chunks(ids, 500):
            self._rpc("mark_jobs_seen", {"ids": chunk})

    def mark_missed(self, ids: list[str]) -> int:
        return sum(self._rpc("mark_jobs_missed", {"ids": c}) or 0 for c in _chunks(ids, 500))

    def close_stale(self, source: str, days: int) -> int:
        return self._rpc("close_stale_jobs", {"p_source": source, "p_days": days}) or 0

    def company_result(self, company_id: str, ok: bool, jobs_open: int, error: str | None) -> None:
        now = datetime.now(UTC).isoformat()
        if ok:
            body: dict[str, Any] = {
                "last_ok_at": now,
                "fail_count": 0,
                "jobs_open": jobs_open,
                "last_error": None,
            }
        else:
            # fail_count is incremented by reading it first; one worker runs at a time.
            res = self.client.get(
                f"{self.rest}/companies", params={"select": "fail_count", "id": f"eq.{company_id}"}
            )
            res.raise_for_status()
            current = (res.json() or [{"fail_count": 0}])[0]["fail_count"]
            body = {"fail_count": current + 1, "last_error": (error or "")[:300]}
        self.client.patch(
            f"{self.rest}/companies", params={"id": f"eq.{company_id}"}, json=body
        ).raise_for_status()

    def start_run(self, source: str) -> str:
        res = self.client.post(
            f"{self.rest}/source_runs",
            headers={"Prefer": "return=representation"},
            json={"source": source},
        )
        res.raise_for_status()
        return res.json()[0]["id"]

    def finish_run(
        self, run_id: str, seen: int, new: int, updated: int, closed: int, errors: list[str]
    ) -> None:
        self.client.patch(
            f"{self.rest}/source_runs",
            params={"id": f"eq.{run_id}"},
            json={
                "finished_at": datetime.now(UTC).isoformat(),
                "jobs_seen": seen,
                "jobs_new": new,
                "jobs_updated": updated,
                "jobs_closed": closed,
                "errors": errors[:50],
            },
        ).raise_for_status()


@dataclass
class MemoryStore:
    """In-memory JobStore for tests."""

    countries: set[str] = field(default_factory=set)
    companies: list[Company] = field(default_factory=list)
    jobs: dict[tuple[str, str], dict[str, Any]] = field(default_factory=dict)
    runs: dict[str, dict[str, Any]] = field(default_factory=dict)
    company_log: list[tuple[str, bool]] = field(default_factory=list)

    def wanted_countries(self) -> set[str]:
        return set(self.countries)

    def active_companies(self, ats: str) -> list[Company]:
        return [c for c in self.companies if c.ats == ats]

    def existing(self, source: str) -> dict[str, Existing]:
        return {
            ext: Existing(
                j["id"],
                ext,
                j.get("content_hash"),
                j.get("company_id"),
                j.get("closed_at") is not None,
            )
            for (src, ext), j in self.jobs.items()
            if src == source
        }

    def open_keys(self) -> tuple[dict[str, str], set[str]]:
        open_jobs = [j for j in self.jobs.values() if j.get("closed_at") is None]
        return {j["dedupe_key"]: j["source"] for j in open_jobs}, {
            j["canonical_url"] for j in open_jobs
        }

    def upsert_jobs(self, rows: list[dict[str, Any]]) -> None:
        for r in rows:
            key = (r["source"], r["external_id"])
            current = self.jobs.get(key, {"id": str(uuid.uuid4()), "missed_runs": 0})
            self.jobs[key] = {**current, **r}

    def _by_id(self, job_id: str) -> dict[str, Any]:
        return next(j for j in self.jobs.values() if j["id"] == job_id)

    def mark_seen(self, ids: list[str]) -> None:
        for i in ids:
            self._by_id(i).update(missed_runs=0, closed_at=None)

    def mark_missed(self, ids: list[str]) -> int:
        closed = 0
        for i in ids:
            j = self._by_id(i)
            if j.get("closed_at") is not None:
                continue
            j["missed_runs"] = j.get("missed_runs", 0) + 1
            if j["missed_runs"] >= 2:
                j["closed_at"] = "now"
                closed += 1
        return closed

    def close_stale(self, source: str, days: int) -> int:
        return 0

    def company_result(self, company_id: str, ok: bool, jobs_open: int, error: str | None) -> None:
        self.company_log.append((company_id, ok))

    def start_run(self, source: str) -> str:
        run_id = str(uuid.uuid4())
        self.runs[run_id] = {"source": source}
        return run_id

    def finish_run(
        self, run_id: str, seen: int, new: int, updated: int, closed: int, errors: list[str]
    ) -> None:
        self.runs[run_id].update(seen=seen, new=new, updated=updated, closed=closed, errors=errors)
