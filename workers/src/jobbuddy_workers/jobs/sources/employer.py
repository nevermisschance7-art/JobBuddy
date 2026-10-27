"""Employer systems (ATS) with public job-board endpoints. Date fields are documented in
workers/SOURCES.md; posted_at only ever comes from a creation/publication field."""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from typing import Any

from ...geo import country_code, parse_locations
from ...http import FetchError, Http
from ..model import Job, RawJob
from ..normalize import (
    MAX_DESCRIPTION_CHARS,
    canonical_url,
    employment_from,
    from_epoch,
    from_iso,
    from_rfc822,
    html_to_text,
    is_internship,
    is_tech_role,
    remote_type_from,
    seniority_from,
)
from .base import Company, dig


def _locations(
    names: list[str | None], codes: list[str | None] | None = None
) -> tuple[list[str], list[str], bool, list[dict[str, Any]]]:
    countries, regions, mentions_remote = parse_locations(names)
    for c in codes or []:
        code = country_code(c)
        if code and code not in countries:
            countries = sorted({*countries, code})
    locs = [{"raw": n} for n in names if n]
    return countries, regions, mentions_remote, locs


# ---------------------------------------------------------------- Greenhouse


class Greenhouse:
    name = "greenhouse"
    kind = "employer"

    def fetch_company(self, http: Http, company: Company) -> list[RawJob]:
        data = http.get_json(
            f"https://boards-api.greenhouse.io/v1/boards/{company.slug}/jobs",
            params={"content": "true"},
        )
        return [
            RawJob(self.name, str(j["id"]), j, company.id, company.name)
            for j in data.get("jobs", [])
        ]

    def normalise(self, raw: RawJob) -> Job | None:
        j = raw.data
        title = j.get("title") or ""
        loc_names = [dig(j, "location", "name")] + [
            o.get("location") for o in j.get("offices") or []
        ]
        countries, regions, remote, locs = _locations(loc_names)
        meta = " ".join(str(m.get("value")) for m in j.get("metadata") or [] if m.get("value"))
        if is_internship(title):
            return None
        return Job(
            source=self.name,
            external_id=raw.external_id,
            canonical_url=canonical_url(j["absolute_url"]),
            apply_url=j["absolute_url"],
            title=title,
            company_name=j.get("company_name") or raw.company_name or "",
            company_id=raw.company_id,
            description_text=html_to_text(j.get("content")),
            countries=countries,
            remote_regions=regions,
            locations=locs,
            remote_type=remote_type_from(None, dig(j, "location", "name"), meta, title),
            employment_type=employment_from(meta),
            seniority=seniority_from(title),
            posted_at=from_iso(j.get("first_published")),
            source_updated_at=from_iso(j.get("updated_at")),
        )


# ---------------------------------------------------------------- Lever


class Lever:
    name = "lever"
    kind = "employer"

    def fetch_company(self, http: Http, company: Company) -> list[RawJob]:
        # "eu:<slug>" marks companies hosted on Lever's EU instance.
        host, slug = (
            ("api.eu.lever.co", company.slug[3:])
            if company.slug.startswith("eu:")
            else ("api.lever.co", company.slug)
        )
        data = http.get_json(f"https://{host}/v0/postings/{slug}", params={"mode": "json"})
        return [RawJob(self.name, j["id"], j, company.id, company.name) for j in data]

    def normalise(self, raw: RawJob) -> Job | None:
        j = raw.data
        title = j.get("text") or ""
        cats = j.get("categories") or {}
        if is_internship(title, cats.get("commitment")):
            return None
        names = cats.get("allLocations") or [cats.get("location")]
        countries, regions, _, locs = _locations(names, [j.get("country")])
        parts = [j.get("descriptionPlain") or html_to_text(j.get("description"))]
        for lst in j.get("lists") or []:
            parts.append(f"{lst.get('text', '')}\n{html_to_text(lst.get('content'))}")
        parts.append(j.get("additionalPlain") or "")
        salary = j.get("salaryRange") or {}
        yearly = (salary.get("interval") or "").lower() in ("per-year-salary", "year", "")
        return Job(
            source=self.name,
            external_id=raw.external_id,
            canonical_url=canonical_url(j["hostedUrl"]),
            apply_url=j.get("applyUrl") or j["hostedUrl"],
            title=title,
            company_name=raw.company_name or "",
            company_id=raw.company_id,
            description_text="\n\n".join(p for p in parts if p).strip()[:MAX_DESCRIPTION_CHARS],
            countries=countries,
            remote_regions=regions,
            locations=locs,
            remote_type=remote_type_from(
                None if j.get("workplaceType") in (None, "unspecified") else j.get("workplaceType"),
                cats.get("location"),
                title,
            ),
            employment_type=employment_from(cats.get("commitment")),
            seniority=seniority_from(title),
            posted_at=from_epoch(j.get("createdAt")),
            salary_min=salary.get("min") if yearly else None,
            salary_max=salary.get("max") if yearly else None,
            salary_currency=salary.get("currency") if yearly and salary.get("min") else None,
        )


# ---------------------------------------------------------------- Ashby


class Ashby:
    name = "ashby"
    kind = "employer"

    def fetch_company(self, http: Http, company: Company) -> list[RawJob]:
        data = http.get_json(
            f"https://api.ashbyhq.com/posting-api/job-board/{company.slug}",
            params={"includeCompensation": "true"},
        )
        return [
            RawJob(self.name, j["id"], j, company.id, company.name)
            for j in data.get("jobs", [])
            if j.get("isListed", True)
        ]

    def normalise(self, raw: RawJob) -> Job | None:
        j = raw.data
        title = j.get("title") or ""
        if is_internship(title, j.get("employmentType")):
            return None
        names = [j.get("location")] + [s.get("location") for s in j.get("secondaryLocations") or []]
        codes = [dig(j, "address", "postalAddress", "addressCountry")] + [
            dig(s, "address", "postalAddress", "addressCountry")
            for s in j.get("secondaryLocations") or []
        ]
        countries, regions, _, locs = _locations(names, codes)
        workplace = j.get("workplaceType") or ("Remote" if j.get("isRemote") else None)

        smin = smax = cur = None
        for comp in dig(j, "compensation", "summaryComponents", default=[]) or []:
            if (
                comp.get("compensationType") == "Salary"
                and "YEAR" in (comp.get("interval") or "").upper()
            ):
                smin, smax, cur = (
                    comp.get("minValue"),
                    comp.get("maxValue"),
                    comp.get("currencyCode"),
                )
                break
        return Job(
            source=self.name,
            external_id=raw.external_id,
            canonical_url=canonical_url(j["jobUrl"]),
            apply_url=j.get("applyUrl") or j["jobUrl"],
            title=title,
            company_name=raw.company_name or "",
            company_id=raw.company_id,
            description_text=(j.get("descriptionPlain") or html_to_text(j.get("descriptionHtml")))[
                :MAX_DESCRIPTION_CHARS
            ],
            countries=countries,
            remote_regions=regions,
            locations=locs,
            remote_type=remote_type_from(workplace, j.get("location"), title),
            employment_type=employment_from(
                re.sub(r"(?<=[a-z])(?=[A-Z])", " ", j.get("employmentType") or "")
            ),
            seniority=seniority_from(title),
            posted_at=from_iso(j.get("publishedAt")),
            salary_min=smin,
            salary_max=smax,
            salary_currency=cur if smin else None,
        )


# ---------------------------------------------------------------- Workable


class Workable:
    name = "workable"
    kind = "employer"

    def fetch_company(self, http: Http, company: Company) -> list[RawJob]:
        data = http.get_json(
            f"https://apply.workable.com/api/v1/widget/accounts/{company.slug}",
            params={"details": "true"},
        )
        name = data.get("name") or company.name
        return [
            RawJob(self.name, j["shortcode"], j, company.id, name) for j in data.get("jobs", [])
        ]

    def normalise(self, raw: RawJob) -> Job | None:
        j = raw.data
        title = j.get("title") or ""
        if is_internship(title, j.get("employment_type"), j.get("experience")):
            return None
        locs_raw = j.get("locations") or [{"city": j.get("city"), "country": j.get("country")}]
        names = [
            ", ".join(x for x in (loc.get("city"), loc.get("region"), loc.get("country")) if x)
            for loc in locs_raw
        ]
        codes = [loc.get("countryCode") or loc.get("country") for loc in locs_raw]
        countries, regions, _, locs = _locations(names, codes)
        return Job(
            source=self.name,
            external_id=raw.external_id,
            canonical_url=canonical_url(j["url"]),
            apply_url=j.get("application_url") or j["url"],
            title=title,
            company_name=raw.company_name or "",
            company_id=raw.company_id,
            description_text=html_to_text(j.get("description")),
            countries=countries,
            remote_regions=regions,
            locations=locs,
            remote_type=remote_type_from(
                "remote" if j.get("telecommuting") else None, title, *names
            ),
            employment_type=employment_from(j.get("employment_type")),
            seniority=seniority_from(title, j.get("experience")),
            # published_on is the posting date; created_at is when the draft was made.
            posted_at=from_iso(j.get("published_on")),
        )


# ---------------------------------------------------------------- SmartRecruiters

_SR_LEVEL = {
    "entry_level": "junior",
    "associate": "junior",
    "mid_senior_level": None,
    "director": "lead",
    "executive": "lead",
}


class SmartRecruiters:
    name = "smartrecruiters"
    kind = "employer"

    def fetch_company(self, http: Http, company: Company) -> list[RawJob]:
        out: list[RawJob] = []
        offset = 0
        while offset < 1000:
            data = http.get_json(
                f"https://api.smartrecruiters.com/v1/companies/{company.slug}/postings",
                params={"limit": 100, "offset": offset},
            )
            items = data.get("content", [])
            out += [RawJob(self.name, str(j["id"]), j, company.id, company.name) for j in items]
            offset += len(items)
            if not items or offset >= data.get("totalFound", 0):
                break
        return out

    def wants_detail(self, raw: RawJob) -> bool:
        """Details cost one request each, so only fetch them for jobs we would keep."""
        title = raw.data.get("name") or ""
        level = dig(raw.data, "experienceLevel", "id")
        return is_tech_role(title) and level != "internship" and not is_internship(title)

    def fetch_detail(self, http: Http, raw: RawJob) -> RawJob:
        """The list lacks the description; fetch it (only done for jobs not stored yet)."""
        try:
            detail = http.get_json(raw.data["ref"])
        except FetchError:
            return raw
        return RawJob(
            raw.source,
            raw.external_id,
            {**raw.data, "detail": detail},
            raw.company_id,
            raw.company_name,
        )

    def normalise(self, raw: RawJob) -> Job | None:
        j = raw.data
        title = j.get("name") or ""
        level = dig(j, "experienceLevel", "id")
        if level == "internship" or is_internship(title):
            return None
        loc = j.get("location") or {}
        countries, regions, _, locs = _locations([loc.get("fullLocation")], [loc.get("country")])
        remote = "remote" if loc.get("remote") else "hybrid" if loc.get("hybrid") else None
        detail = j.get("detail") or {}
        sections = dig(detail, "jobAd", "sections", default={}) or {}
        description = "\n\n".join(
            f"{s.get('title', '')}\n{html_to_text(s.get('text'))}".strip()
            for key in (
                "jobDescription",
                "qualifications",
                "additionalInformation",
                "companyDescription",
            )
            if (s := sections.get(key))
        )
        company_ident = dig(j, "company", "identifier") or ""
        url = (
            detail.get("postingUrl")
            or f"https://jobs.smartrecruiters.com/{company_ident}/{raw.external_id}"
        )
        seniority = _SR_LEVEL.get(level or "") or seniority_from(title)
        return Job(
            source=self.name,
            external_id=raw.external_id,
            canonical_url=canonical_url(url),
            apply_url=detail.get("applyUrl") or url,
            title=title,
            company_name=dig(j, "company", "name") or raw.company_name or "",
            company_id=raw.company_id,
            description_text=description[:MAX_DESCRIPTION_CHARS],
            countries=countries,
            remote_regions=regions,
            locations=locs,
            remote_type=remote
            or remote_type_from(None, title)
            or ("onsite" if loc.get("city") else None),
            employment_type=employment_from(dig(j, "typeOfEmployment", "label")),
            seniority=seniority,  # type: ignore[arg-type]
            posted_at=from_iso(j.get("releasedDate")),
        )


# ---------------------------------------------------------------- Teamtailor

_TT = "{https://teamtailor.com/locations}"


class Teamtailor:
    name = "teamtailor"
    kind = "employer"

    def fetch_company(self, http: Http, company: Company) -> list[RawJob]:
        host = company.slug if "." in company.slug else f"{company.slug}.teamtailor.com"
        xml = http.get_text(f"https://{host}/jobs.rss")
        return [
            RawJob(self.name, item["guid"], item, company.id, company.name)
            for item in parse_teamtailor_rss(xml)
        ]

    def normalise(self, raw: RawJob) -> Job | None:
        j = raw.data
        title = j.get("title") or ""
        if is_internship(title):
            return None
        names = [
            ", ".join(x for x in (loc.get("city"), loc.get("country")) if x)
            for loc in j.get("locations", [])
        ]
        codes = [loc.get("country") for loc in j.get("locations", [])]
        countries, regions, _, locs = _locations(names, codes)
        status = j.get("remoteStatus")
        return Job(
            source=self.name,
            external_id=raw.external_id,
            canonical_url=canonical_url(j["link"]),
            apply_url=j["link"],
            title=title,
            company_name=raw.company_name or "",
            company_id=raw.company_id,
            description_text=html_to_text(j.get("description")),
            countries=countries,
            remote_regions=regions,
            locations=locs,
            remote_type=remote_type_from(None if status in (None, "none") else status, title)
            or ("onsite" if status == "none" else None),
            employment_type="unknown",
            seniority=seniority_from(title),
            posted_at=from_rfc822(j.get("pubDate")),
        )


def parse_teamtailor_rss(xml: str) -> list[dict[str, Any]]:
    root = ET.fromstring(xml)
    items = []
    for item in root.iter("item"):
        locations = [
            {"city": loc.findtext(f"{_TT}city"), "country": loc.findtext(f"{_TT}country")}
            for loc in item.iter(f"{_TT}location")
        ]
        guid = item.findtext("guid") or item.findtext("link") or ""
        items.append(
            {
                "guid": guid,
                "title": item.findtext("title"),
                "link": item.findtext("link"),
                "description": item.findtext("description"),
                "pubDate": item.findtext("pubDate"),
                "remoteStatus": item.findtext("remoteStatus"),
                "department": item.findtext(f"{_TT}department"),
                "locations": locations,
            }
        )
    return items


# ---------------------------------------------------------------- Workday
# Slug "tenant|wdN|site", e.g. "nvidia|wd5|NVIDIAExternalCareerSite". The list is sorted
# newest first and only says "Posted Today" etc.; the detail has the exact posting date
# (startDate) and the location, so details are fetched for recent tech jobs only.

_WD_AGE = re.compile(r"posted (today|yesterday|(\d+)\+? days? ago)", re.I)


def workday_age_days(posted_on: str | None) -> int | None:
    m = _WD_AGE.search(posted_on or "")
    if not m:
        return None
    word = m.group(1).lower()
    if word == "today":
        return 0
    if word == "yesterday":
        return 1
    return int(m.group(2))


class Workday:
    name = "workday"
    kind = "employer"
    complete_listing = False  # paged by recency; we stop once postings are older than 2 days
    MAX_PAGES = 10

    @staticmethod
    def _base(slug: str) -> tuple[str, str]:
        tenant, wd, site = slug.split("|")
        host = f"https://{tenant}.{wd}.myworkdayjobs.com"
        return host, f"{host}/wday/cxs/{tenant}/{site}"

    def fetch_company(self, http: Http, company: Company) -> list[RawJob]:
        host, api = self._base(company.slug)
        out: list[RawJob] = []
        for page in range(self.MAX_PAGES):
            body = {"limit": 20, "offset": page * 20, "searchText": "", "appliedFacets": {}}
            posts = http.post_json(f"{api}/jobs", body).get("jobPostings", [])
            for p in posts:
                item = {**p, "_host": host, "_api": api}
                out.append(RawJob(self.name, p["externalPath"], item, company.id, company.name))
            ages = [workday_age_days(p.get("postedOn")) for p in posts]
            if len(posts) < 20 or all(a is not None and a > 2 for a in ages):
                break
        return out

    def prefilter(self, raw: RawJob) -> bool:
        age = workday_age_days(raw.data.get("postedOn"))
        title = raw.data.get("title") or ""
        return age is not None and age <= 2 and is_tech_role(title) and not is_internship(title)

    def fetch_detail(self, http: Http, raw: RawJob) -> RawJob:
        try:
            detail = http.get_json(raw.data["_api"] + raw.data["externalPath"])
        except FetchError:
            return raw
        data = {**raw.data, "detail": detail.get("jobPostingInfo", {})}
        return RawJob(raw.source, raw.external_id, data, raw.company_id, raw.company_name)

    def normalise(self, raw: RawJob) -> Job | None:
        j = raw.data
        d = j.get("detail")
        if not d:
            return None  # the list alone has no date or location
        title = d.get("title") or j.get("title") or ""
        if is_internship(title, d.get("timeType")):
            return None
        names = [d.get("location"), *(d.get("additionalLocations") or [])]
        countries, regions, _, locs = _locations(names, [dig(d, "country", "descriptor")])
        description = html_to_text(d.get("jobDescription"))
        url = d.get("externalUrl") or j["_host"] + j["externalPath"]
        return Job(
            source=self.name,
            external_id=raw.external_id,
            canonical_url=canonical_url(url),
            apply_url=url,
            title=title,
            company_name=raw.company_name or "",
            company_id=raw.company_id,
            description_text=description,
            countries=countries,
            remote_regions=regions,
            locations=locs,
            remote_type=remote_type_from(d.get("remoteType"), *names, title, description[:600]),
            employment_type=employment_from(d.get("timeType")),
            seniority=seniority_from(title),
            posted_at=from_iso(d.get("startDate")),
        )


# ---------------------------------------------------------------- Personio (XML feed)


def parse_personio_xml(xml: str, host: str) -> list[dict[str, Any]]:
    items = []
    for pos in ET.fromstring(xml).iter("position"):
        item: dict[str, Any] = {c.tag: (c.text or "").strip() for c in pos if len(c) == 0}
        offices = [o.text for o in pos.iter("office") if o.text]
        item["additionalOffices"] = offices[1:]
        item["description"] = "\n\n".join(
            f"{jd.findtext('name') or ''}\n{jd.findtext('value') or ''}"
            for jd in pos.iter("jobDescription")
        )
        item["_host"] = host
        items.append(item)
    return items


class Personio:
    name = "personio"
    kind = "employer"

    def fetch_company(self, http: Http, company: Company) -> list[RawJob]:
        host = company.slug if "." in company.slug else f"{company.slug}.jobs.personio.de"
        xml = http.get_text(f"https://{host}/xml?language=en")
        return [
            RawJob(self.name, item.get("id", ""), item, company.id, company.name)
            for item in parse_personio_xml(xml, host)
        ]

    def normalise(self, raw: RawJob) -> Job | None:
        j = raw.data
        title = j.get("name") or ""
        if is_internship(title, j.get("employmentType"), j.get("seniority")):
            return None
        names = [j.get("office"), *j.get("additionalOffices", [])]
        countries, regions, _, locs = _locations(names)
        description = html_to_text(j.get("description"))
        url = f"https://{j['_host']}/job/{raw.external_id}"
        return Job(
            source=self.name,
            external_id=raw.external_id,
            canonical_url=canonical_url(url),
            apply_url=url,
            title=title,
            company_name=j.get("subcompany") or raw.company_name or "",
            company_id=raw.company_id,
            description_text=description,
            countries=countries,
            remote_regions=regions,
            locations=locs,
            remote_type=remote_type_from(None, *names, title, j.get("schedule"), description[:600]),
            employment_type=employment_from(j.get("schedule"), j.get("employmentType")),
            seniority=seniority_from(title, j.get("seniority")),
            posted_at=from_iso(j.get("createdAt")),
        )


# ---------------------------------------------------------------- Recruitee


class Recruitee:
    name = "recruitee"
    kind = "employer"

    def fetch_company(self, http: Http, company: Company) -> list[RawJob]:
        data = http.get_json(f"https://{company.slug}.recruitee.com/api/offers/")
        return [
            RawJob(self.name, str(o["id"]), o, company.id, company.name)
            for o in data.get("offers", [])
        ]

    def normalise(self, raw: RawJob) -> Job | None:
        j = raw.data
        title = j.get("title") or ""
        if is_internship(title, j.get("employment_type_code")):
            return None
        extra = [loc.get("name") for loc in j.get("locations") or [] if isinstance(loc, dict)]
        names = [j.get("location"), *extra]
        countries, regions, _, locs = _locations(names, [j.get("country_code")])
        description = html_to_text(f"{j.get('description') or ''}\n{j.get('requirements') or ''}")
        published = (j.get("published_at") or j.get("created_at") or "").replace(" UTC", "+00:00")
        url = j.get("careers_url") or ""
        return Job(
            source=self.name,
            external_id=raw.external_id,
            canonical_url=canonical_url(url),
            apply_url=j.get("careers_apply_url") or url,
            title=title,
            company_name=j.get("company_name") or raw.company_name or "",
            company_id=raw.company_id,
            description_text=description,
            countries=countries,
            remote_regions=regions,
            locations=locs,
            remote_type="remote" if j.get("remote") else remote_type_from(None, *names, title),
            employment_type=employment_from(j.get("employment_type_code")),
            seniority=seniority_from(title),
            posted_at=from_iso(published),
        )


EMPLOYER_SOURCES = {
    s.name: s
    for s in [
        Greenhouse(),
        Lever(),
        Ashby(),
        Workable(),
        SmartRecruiters(),
        Teamtailor(),
        Workday(),
        Personio(),
        Recruitee(),
    ]
}
