"""The source adapter interface."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from ...http import Http
from ..model import Job, RawJob


@dataclass
class Company:
    id: str
    name: str
    ats: str
    slug: str


@dataclass
class FetchContext:
    """What this run should fetch."""

    # Countries at least one user can work in. Empty means "no users yet: fetch broadly".
    wanted_countries: set[str] = field(default_factory=set)
    env: dict[str, str] = field(default_factory=dict)
    # Max pages per query for paged aggregators, to stay inside free API limits.
    max_pages: int = 3


class EmployerSource(Protocol):
    """An employer system (ATS). Lists every open job of one company, so a job missing
    from a successful listing really is gone."""

    name: str
    kind: str  # "employer"

    def fetch_company(self, http: Http, company: Company) -> list[RawJob]: ...
    def normalise(self, raw: RawJob) -> Job | None: ...


class AggregatorSource(Protocol):
    """A job board or aggregator. Listings are partial (newest pages only), so a missing
    job is not proof it closed."""

    name: str
    kind: str  # "aggregator"
    every_hours: int

    def available(self, ctx: FetchContext) -> bool: ...
    def fetch(self, http: Http, ctx: FetchContext) -> list[RawJob]: ...
    def normalise(self, raw: RawJob) -> Job | None: ...


class DetailSource(Protocol):
    """Sources whose list endpoint lacks the description. Details are fetched only for
    jobs not stored yet."""

    def fetch_detail(self, http: Http, raw: RawJob) -> RawJob: ...


def dig(obj: Any, *path: str | int, default: Any = None) -> Any:
    for key in path:
        if isinstance(obj, dict):
            obj = obj.get(key)  # type: ignore[arg-type]
        elif isinstance(obj, list) and isinstance(key, int) and -len(obj) <= key < len(obj):
            obj = obj[key]
        else:
            return default
        if obj is None:
            return default
    return obj
