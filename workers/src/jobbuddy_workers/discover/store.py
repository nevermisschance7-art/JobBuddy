"""Supabase access for discovery (service role)."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from typing import Any

from ..jobs.normalize import from_iso
from ..jobs.sources import AGGREGATOR_SOURCES
from ..jobs.store import SupabaseStore
from .run import KnownCompany


class SupabaseDiscoveryStore(SupabaseStore):
    def companies(self) -> list[KnownCompany]:
        rows = self._get_all("companies", {"select": "id,ats,slug,active,fail_count,checked_at"})
        return [
            KnownCompany(
                r["id"],
                r["ats"],
                r["slug"],
                r["active"],
                r["fail_count"],
                from_iso(r["checked_at"]),
            )
            for r in rows
        ]

    def job_link_texts(self) -> Iterable[str]:
        """Links and descriptions of recent aggregator jobs, where employer links show up."""
        since = (datetime.now(UTC) - timedelta(days=8)).isoformat()
        sources = ",".join(AGGREGATOR_SOURCES)
        rows = self._get_all(
            "jobs",
            {
                "select": "apply_url,canonical_url,description_text",
                "source": f"in.({sources})",
                "first_seen_at": f"gte.{since}",
            },
        )
        for r in rows:
            yield f"{r['apply_url']} {r['canonical_url']} {r['description_text'] or ''}"

    def insert_companies(self, rows: list[dict[str, Any]]) -> None:
        for i in range(0, len(rows), 200):
            res = self.client.post(
                f"{self.rest}/companies",
                params={"on_conflict": "ats,slug"},
                headers={"Prefer": "resolution=ignore-duplicates,return=minimal"},
                json=rows[i : i + 200],
            )
            res.raise_for_status()

    def update_company(self, company_id: str, fields: dict[str, Any]) -> None:
        self.client.patch(
            f"{self.rest}/companies", params={"id": f"eq.{company_id}"}, json=fields
        ).raise_for_status()
