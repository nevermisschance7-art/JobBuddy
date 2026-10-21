"""Job records as they move through the pipeline."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from .normalize import EmploymentType, RemoteType, Seniority


@dataclass
class RawJob:
    """One posting exactly as a source returned it."""

    source: str
    external_id: str
    data: Any
    company_id: str | None = None
    company_name: str | None = None


@dataclass
class Job:
    """A normalised posting, ready to store. Mirrors the jobs table."""

    source: str
    external_id: str
    canonical_url: str
    apply_url: str
    title: str
    company_name: str
    description_text: str
    countries: list[str]
    remote_regions: list[str]
    locations: list[dict[str, Any]]
    remote_type: RemoteType | None
    employment_type: EmploymentType
    seniority: Seniority
    # Only from a real creation/publication field. None means "Date unknown".
    posted_at: datetime | None
    source_updated_at: datetime | None = None
    company_id: str | None = None
    salary_min: float | None = None
    salary_max: float | None = None
    salary_currency: str | None = None
    tags: list[str] = field(default_factory=list)

    @property
    def date_source(self) -> str:
        return "source_field" if self.posted_at else "unknown"
