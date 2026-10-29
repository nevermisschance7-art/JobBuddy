"""Job boards and aggregators with free APIs or feeds. Each fetches only its newest pages,
on its own schedule (every_hours) to stay inside free limits and terms."""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from typing import Any

from ...geo import COUNTRIES, country_code, parse_locations
from ...http import Http
from ..model import Job, RawJob
from ..normalize import (
    canonical_url,
    employment_from,
    from_dmy,
    from_epoch,
    from_iso,
    from_rfc822,
    html_to_text,
    is_internship,
    is_tech_role,
    remote_type_from,
    seniority_from,
)
from .base import FetchContext, dig


def _remote_job(
    source: str,
    raw: RawJob,
    *,
    title: str,
    company: str,
    url: str,
    apply_url: str | None,
    description: str,
    location: str | None,
    posted_at: Any,
    employment: str | None = None,
    salary: tuple[Any, Any, Any] = (None, None, None),
    tags: list[str] | None = None,
) -> Job | None:
    """Shared normalisation for remote-only boards."""
    if is_internship(title, employment):
        return None
    countries, regions, _ = parse_locations([location])
    if not countries and not regions:
        regions = ["WORLDWIDE"]
    smin, smax, cur = salary
    return Job(
        source=source,
        external_id=raw.external_id,
        canonical_url=canonical_url(url),
        apply_url=apply_url or url,
        title=title,
        company_name=company,
        description_text=description,
        countries=countries,
        remote_regions=regions,
        locations=[{"raw": location}] if location else [],
        remote_type="remote",
        employment_type=employment_from(employment),
        seniority=seniority_from(title),
        posted_at=posted_at,
        salary_min=smin or None,
        salary_max=smax or None,
        salary_currency=cur if smin else None,
        tags=tags or [],
    )


# ---------------------------------------------------------------- Remotive
# Remotive asks for at most 4 calls a day.


class Remotive:
    name = "remotive"
    kind = "aggregator"
    every_hours = 6
    CATEGORIES = ["software-dev", "devops", "data", "qa"]

    def available(self, ctx: FetchContext) -> bool:
        return True

    def fetch(self, http: Http, ctx: FetchContext) -> list[RawJob]:
        out: list[RawJob] = []
        for cat in self.CATEGORIES:
            data = http.get_json("https://remotive.com/api/remote-jobs", params={"category": cat})
            out += [RawJob(self.name, str(j["id"]), j) for j in data.get("jobs", [])]
        return out

    def normalise(self, raw: RawJob) -> Job | None:
        j = raw.data
        return _remote_job(
            self.name,
            raw,
            title=j.get("title") or "",
            company=j.get("company_name") or "",
            url=j["url"],
            apply_url=j["url"],
            description=html_to_text(j.get("description")),
            location=j.get("candidate_required_location"),
            posted_at=from_iso(j.get("publication_date")),
            employment=j.get("job_type"),
            tags=j.get("tags"),
        )


# ---------------------------------------------------------------- Himalayas


class Himalayas:
    name = "himalayas"
    kind = "aggregator"
    every_hours = 2

    def available(self, ctx: FetchContext) -> bool:
        return True

    def fetch(self, http: Http, ctx: FetchContext) -> list[RawJob]:
        out: list[RawJob] = []
        for page in range(ctx.max_pages * 3):
            data = http.get_json(
                "https://himalayas.app/jobs/api", params={"limit": 20, "offset": page * 20}
            )
            jobs = data.get("jobs", [])
            out += [RawJob(self.name, j.get("guid") or j["applicationLink"], j) for j in jobs]
            if len(jobs) < 20:
                break
        return out

    def normalise(self, raw: RawJob) -> Job | None:
        j = raw.data
        restrictions = j.get("locationRestrictions") or []
        yearly = (j.get("salaryPeriod") or "annual") == "annual"
        return _remote_job(
            self.name,
            raw,
            title=j.get("title") or "",
            company=j.get("companyName") or "",
            url=j.get("guid") or j["applicationLink"],
            apply_url=j.get("applicationLink"),
            description=html_to_text(j.get("description")),
            location=", ".join(restrictions) if restrictions else "Worldwide",
            posted_at=from_epoch(j.get("pubDate")),
            employment=j.get("employmentType"),
            salary=(j.get("minSalary"), j.get("maxSalary"), j.get("currency"))
            if yearly
            else (None, None, None),
            tags=j.get("categories"),
        )


# ---------------------------------------------------------------- Arbeitnow (Europe, many remote)


class Arbeitnow:
    name = "arbeitnow"
    kind = "aggregator"
    every_hours = 2

    def available(self, ctx: FetchContext) -> bool:
        return True

    def fetch(self, http: Http, ctx: FetchContext) -> list[RawJob]:
        out: list[RawJob] = []
        for page in range(1, ctx.max_pages + 1):
            data = http.get_json(
                "https://www.arbeitnow.com/api/job-board-api", params={"page": page}
            )
            out += [RawJob(self.name, j["slug"], j) for j in data.get("data", [])]
            if not dig(data, "links", "next"):
                break
        return out

    def normalise(self, raw: RawJob) -> Job | None:
        j = raw.data
        title = j.get("title") or ""
        if is_internship(title, " ".join(j.get("job_types") or [])):
            return None
        countries, regions, _ = parse_locations([j.get("location")])
        if not countries:
            countries = ["DE"]  # Arbeitnow lists German and EU jobs; city names alone are German.
        return Job(
            source=self.name,
            external_id=raw.external_id,
            canonical_url=canonical_url(j["url"]),
            apply_url=j["url"],
            title=title,
            company_name=j.get("company_name") or "",
            description_text=html_to_text(j.get("description")),
            countries=countries,
            remote_regions=regions,
            locations=[{"raw": j.get("location")}] if j.get("location") else [],
            remote_type="remote" if j.get("remote") else remote_type_from(None, title),
            employment_type=employment_from(" ".join(j.get("job_types") or [])),
            seniority=seniority_from(title),
            posted_at=from_epoch(j.get("created_at")),
            tags=j.get("tags") or [],
        )


# ---------------------------------------------------------------- We Work Remotely (RSS)


class WeWorkRemotely:
    name = "weworkremotely"
    kind = "aggregator"
    every_hours = 4
    FEEDS = [
        "remote-full-stack-programming-jobs",
        "remote-back-end-programming-jobs",
        "remote-front-end-programming-jobs",
        "remote-devops-sysadmin-jobs",
    ]

    def available(self, ctx: FetchContext) -> bool:
        return True

    def fetch(self, http: Http, ctx: FetchContext) -> list[RawJob]:
        out: list[RawJob] = []
        for feed in self.FEEDS:
            xml = http.get_text(f"https://weworkremotely.com/categories/{feed}.rss")
            out += [RawJob(self.name, i["guid"], i) for i in parse_rss(xml)]
        return out

    def normalise(self, raw: RawJob) -> Job | None:
        j = raw.data
        company, _, title = (j.get("title") or "").partition(": ")
        if not title:
            company, title = "", company
        return _remote_job(
            self.name,
            raw,
            title=title.strip(),
            company=company.strip(),
            url=j["link"],
            apply_url=j["link"],
            description=html_to_text(j.get("description")),
            location=j.get("region"),
            posted_at=from_rfc822(j.get("pubDate")),
            employment=j.get("type"),
        )


def parse_rss(xml: str) -> list[dict[str, Any]]:
    root = ET.fromstring(xml)
    out = []
    for item in root.iter("item"):
        row = {child.tag.split("}")[-1]: (child.text or "").strip() for child in item}
        row["guid"] = row.get("guid") or row.get("link", "")
        out.append(row)
    return out


# ---------------------------------------------------------------- Adzuna
# About 20 countries. Needs ADZUNA_APP_ID and ADZUNA_APP_KEY.

ADZUNA_COUNTRIES = ("gb us at au be br ca ch de es fr in it mx nl nz pl sg za").split()


class Adzuna:
    name = "adzuna"
    kind = "aggregator"
    every_hours = 4

    def available(self, ctx: FetchContext) -> bool:
        return bool(ctx.env.get("ADZUNA_APP_ID") and ctx.env.get("ADZUNA_APP_KEY"))

    def fetch(self, http: Http, ctx: FetchContext) -> list[RawJob]:
        out: list[RawJob] = []
        for cc in ADZUNA_COUNTRIES:
            if ctx.wanted_countries and cc.upper() not in ctx.wanted_countries:
                continue
            data = http.get_json(
                f"https://api.adzuna.com/v1/api/jobs/{cc}/search/1",
                params={
                    "app_id": ctx.env["ADZUNA_APP_ID"],
                    "app_key": ctx.env["ADZUNA_APP_KEY"],
                    "results_per_page": 50,
                    "category": "it-jobs",
                    "max_days_old": 3,
                    "sort_by": "date",
                    "content-type": "application/json",
                },
            )
            out += [
                RawJob(self.name, str(j["id"]), {**j, "_country": cc.upper()})
                for j in data.get("results", [])
            ]
        return out

    def normalise(self, raw: RawJob) -> Job | None:
        j = raw.data
        title = html_to_text(j.get("title"))
        if is_internship(title):
            return None
        area = dig(j, "location", "area", default=[]) or []
        country = raw.data["_country"]
        _, regions, _ = parse_locations([dig(j, "location", "display_name")])
        predicted = str(j.get("salary_is_predicted", "0")) == "1"
        return Job(
            source=self.name,
            external_id=raw.external_id,
            canonical_url=canonical_url(j["redirect_url"]),
            apply_url=j["redirect_url"],
            title=title,
            company_name=dig(j, "company", "display_name") or "",
            # Adzuna only returns a snippet of the description.
            description_text=html_to_text(j.get("description")),
            countries=[country],
            remote_regions=regions,
            locations=[{"raw": ", ".join(area[1:]) or dig(j, "location", "display_name")}],
            remote_type=remote_type_from(None, title, j.get("description")),
            employment_type=employment_from(j.get("contract_time"), j.get("contract_type")),
            seniority=seniority_from(title),
            posted_at=from_iso(j.get("created")),
            # Adzuna estimates salaries it isn't given. Only stated salaries are kept.
            salary_min=None if predicted else j.get("salary_min"),
            salary_max=None if predicted else j.get("salary_max"),
            salary_currency=None,
        )


# ---------------------------------------------------------------- Reed (UK only, needs a key)


class Reed:
    name = "reed"
    kind = "aggregator"
    every_hours = 4

    def available(self, ctx: FetchContext) -> bool:
        return bool(ctx.env.get("REED_API_KEY")) and (
            not ctx.wanted_countries or "GB" in ctx.wanted_countries
        )

    def fetch(self, http: Http, ctx: FetchContext) -> list[RawJob]:
        out: list[RawJob] = []
        for keywords in ("software developer", "software engineer", "data engineer", "devops"):
            data = http.get_json(
                "https://www.reed.co.uk/api/1.0/search",
                params={"keywords": keywords, "resultsToTake": 100},
                auth=(ctx.env["REED_API_KEY"], ""),
            )
            out += [RawJob(self.name, str(j["jobId"]), j) for j in data.get("results", [])]
        return out

    def normalise(self, raw: RawJob) -> Job | None:
        j = raw.data
        title = j.get("jobTitle") or ""
        if is_internship(title):
            return None
        _, regions, _ = parse_locations([j.get("locationName")])
        return Job(
            source=self.name,
            external_id=raw.external_id,
            canonical_url=canonical_url(j["jobUrl"]),
            apply_url=j["jobUrl"],
            title=title,
            company_name=j.get("employerName") or "",
            description_text=html_to_text(j.get("jobDescription")),
            countries=["GB"],
            remote_regions=regions,
            locations=[{"raw": j.get("locationName")}] if j.get("locationName") else [],
            remote_type=remote_type_from(
                None, title, j.get("locationName"), j.get("jobDescription")
            ),
            employment_type="unknown",
            seniority=seniority_from(title),
            posted_at=from_dmy(j.get("date")),
            salary_min=j.get("minimumSalary"),
            salary_max=j.get("maximumSalary"),
            salary_currency=(j.get("currency") or "GBP") if j.get("minimumSalary") else None,
        )


# ---------------------------------------------------------------- Jooble
# About 70 countries. Needs JOOBLE_API_KEY.


class Jooble:
    name = "jooble"
    kind = "aggregator"
    every_hours = 6

    def available(self, ctx: FetchContext) -> bool:
        return bool(ctx.env.get("JOOBLE_API_KEY"))

    def fetch(self, http: Http, ctx: FetchContext) -> list[RawJob]:
        locations = sorted(COUNTRIES[c] for c in ctx.wanted_countries if c in COUNTRIES) or [""]
        out: list[RawJob] = []
        for location in locations[:25]:
            data = http.post_json(
                f"https://jooble.org/api/{ctx.env['JOOBLE_API_KEY']}",
                {"keywords": "software developer", "location": location, "page": 1},
            )
            out += [
                RawJob(self.name, str(j["id"]), {**j, "_location": location})
                for j in data.get("jobs", [])
            ]
        return out

    def normalise(self, raw: RawJob) -> Job | None:
        j = raw.data
        title = html_to_text(j.get("title"))
        if is_internship(title, j.get("type")):
            return None
        countries, regions, _ = parse_locations([j.get("location")])
        if not countries and j.get("_location"):
            code = country_code(j["_location"])
            countries = [code] if code else []
        return Job(
            source=self.name,
            external_id=raw.external_id,
            canonical_url=canonical_url(j["link"]),
            apply_url=j["link"],
            title=title,
            company_name=j.get("company") or "",
            description_text=html_to_text(j.get("snippet")),
            countries=countries,
            remote_regions=regions,
            locations=[{"raw": j.get("location")}] if j.get("location") else [],
            remote_type=remote_type_from(None, title, j.get("location"), j.get("snippet")),
            employment_type=employment_from(j.get("type")),
            seniority=seniority_from(title),
            # Jooble only has "updated", which is not a posting date.
            posted_at=None,
            source_updated_at=from_iso(j.get("updated")),
        )


# ---------------------------------------------------------------- Jobicy (remote only, free API)


class Jobicy:
    name = "jobicy"
    kind = "aggregator"
    every_hours = 2

    def available(self, ctx: FetchContext) -> bool:
        return True

    def fetch(self, http: Http, ctx: FetchContext) -> list[RawJob]:
        data = http.get_json(
            "https://jobicy.com/api/v2/remote-jobs", params={"count": 100, "industry": "dev"}
        )
        return [RawJob(self.name, str(j["id"]), j) for j in data.get("jobs", [])]

    def normalise(self, raw: RawJob) -> Job | None:
        j = raw.data
        geo = j.get("jobGeo")
        return _remote_job(
            self.name,
            raw,
            title=j.get("jobTitle") or "",
            company=j.get("companyName") or "",
            url=j["url"],
            apply_url=j["url"],
            description=html_to_text(j.get("jobDescription") or j.get("jobExcerpt")),
            location=None if (geo or "").lower() in ("anywhere", "") else geo,
            posted_at=from_iso(j.get("pubDate")),
            employment=" ".join(j.get("jobType") or []),
            salary=(j.get("annualSalaryMin"), j.get("annualSalaryMax"), j.get("salaryCurrency")),
        )


# ---------------------------------------------------------------- Working Nomads (remote only)


class WorkingNomads:
    name = "workingnomads"
    kind = "aggregator"
    every_hours = 2

    def available(self, ctx: FetchContext) -> bool:
        return True

    def fetch(self, http: Http, ctx: FetchContext) -> list[RawJob]:
        data = http.get_json("https://www.workingnomads.com/api/exposed_jobs/")
        return [
            RawJob(self.name, j["url"], j) for j in data if isinstance(j, dict) and j.get("url")
        ]

    def normalise(self, raw: RawJob) -> Job | None:
        j = raw.data
        return _remote_job(
            self.name,
            raw,
            title=j.get("title") or "",
            company=j.get("company_name") or "",
            url=j["url"],
            apply_url=j["url"],
            description=html_to_text(j.get("description")),
            location=j.get("location") or None,
            posted_at=from_iso(j.get("pub_date")),
            tags=[t.strip() for t in (j.get("tags") or "").split(",") if t.strip()],
        )


# ---------------------------------------------------------------- Hacker News "Who is hiring"
# One thread a month; each top-level comment is one company's posting, and its timestamp is
# when it was posted. Most start with "Company | Role | Location | REMOTE | ...".


class HackerNews:
    name = "hackernews"
    kind = "aggregator"
    every_hours = 2

    def available(self, ctx: FetchContext) -> bool:
        return True

    def fetch(self, http: Http, ctx: FetchContext) -> list[RawJob]:
        search = http.get_json(
            "https://hn.algolia.com/api/v1/search_by_date",
            params={"tags": "story,author_whoishiring", "hitsPerPage": 5},
        )
        thread = next(
            (h for h in search.get("hits", []) if "who is hiring" in h["title"].lower()), None
        )
        if not thread:
            return []
        item = http.get_json(f"https://hn.algolia.com/api/v1/items/{thread['objectID']}")
        return [
            RawJob(self.name, str(c["id"]), c)
            for c in item.get("children", [])
            if c.get("text") and c.get("author")
        ]

    def normalise(self, raw: RawJob) -> Job | None:
        j = raw.data
        text = html_to_text(j.get("text"))
        first = text.split("\n", 1)[0]
        parts = [p.strip() for p in re.split(r"\s+[|—–]\s+|\s+-\s+", first) if p.strip()]
        if len(parts) < 2 or not re.search(r"\bremote\b", first, re.I):
            return None
        if re.search(r"\b(no remote|not remote|onsite only|on-site only)\b", first, re.I):
            return None
        company = parts[0][:100]
        role = next((p for p in parts[1:] if is_tech_role(p)), parts[1])
        location = next((p for p in parts[1:] if re.search(r"\bremote\b", p, re.I)), None)
        url = f"https://news.ycombinator.com/item?id={raw.external_id}"
        return _remote_job(
            self.name,
            raw,
            title=role[:200],
            company=company,
            url=url,
            apply_url=url,
            description=text,
            location=location,
            posted_at=from_iso(j.get("created_at")),
        )


AGGREGATOR_SOURCES = {
    s.name: s
    for s in [
        Remotive(),
        Himalayas(),
        Arbeitnow(),
        WeWorkRemotely(),
        Jobicy(),
        WorkingNomads(),
        HackerNews(),
        Adzuna(),
        Reed(),
        Jooble(),
    ]
}
