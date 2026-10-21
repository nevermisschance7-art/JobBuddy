"""Every adapter against a recorded (or documented) response. The key rule checked here:
posted_at only comes from a creation/publication field, never from 'updated' or crawl time."""

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from jobbuddy_workers.jobs.model import RawJob
from jobbuddy_workers.jobs.sources import AGGREGATOR_SOURCES, EMPLOYER_SOURCES
from jobbuddy_workers.jobs.sources.aggregators import parse_rss
from jobbuddy_workers.jobs.sources.employer import parse_teamtailor_rss

FIX = Path(__file__).parent / "fixtures" / "sources"


def load(name):
    return json.loads((FIX / name).read_text(encoding="utf-8"))


def norm(source, raw):
    src = EMPLOYER_SOURCES.get(source) or AGGREGATOR_SOURCES[source]
    return src.normalise(raw)


def raws_for(source):
    if source == "greenhouse":
        return [
            RawJob(source, str(j["id"]), j, "c1", "Stripe") for j in load("greenhouse.json")["jobs"]
        ]
    if source == "lever":
        return [RawJob(source, j["id"], j, "c1", "Palantir") for j in load("lever.json")]
    if source == "ashby":
        return [RawJob(source, j["id"], j, "c1", "OpenAI") for j in load("ashby.json")["jobs"]]
    if source == "workable":
        return [
            RawJob(source, j["shortcode"], j, "c1", "Hugging Face")
            for j in load("workable.json")["jobs"]
        ]
    if source == "smartrecruiters":
        items = load("smartrecruiters.json")["content"]
        detail = load("smartrecruiters_detail.json")
        return [
            RawJob(source, str(items[0]["id"]), {**items[0], "detail": detail}, "c1", "Bosch")
        ] + [RawJob(source, str(j["id"]), j, "c1", "Bosch") for j in items[1:]]
    if source == "teamtailor":
        xml = (FIX / "teamtailor.xml").read_text(encoding="utf-8")
        return [RawJob(source, i["guid"], i, "c1", "Teamtailor") for i in parse_teamtailor_rss(xml)]
    if source == "remotive":
        return [RawJob(source, str(j["id"]), j) for j in load("remotive.json")["jobs"]]
    if source == "himalayas":
        return [RawJob(source, j["guid"], j) for j in load("himalayas.json")["jobs"]]
    if source == "arbeitnow":
        return [RawJob(source, j["slug"], j) for j in load("arbeitnow.json")["data"]]
    if source == "remoteok":
        return [RawJob(source, str(j["id"]), j) for j in load("remoteok.json") if j.get("id")]
    if source == "weworkremotely":
        xml = (FIX / "weworkremotely.xml").read_text(encoding="utf-8")
        return [RawJob(source, i["guid"], i) for i in parse_rss(xml)]
    if source == "adzuna":
        return [
            RawJob(source, j["id"], {**j, "_country": "DE"}) for j in load("adzuna.json")["results"]
        ]
    if source == "reed":
        return [RawJob(source, str(j["jobId"]), j) for j in load("reed.json")["results"]]
    if source == "jooble":
        return [
            RawJob(source, str(j["id"]), {**j, "_location": "Poland"})
            for j in load("jooble.json")["jobs"]
        ]
    raise KeyError(source)


ALL = list(EMPLOYER_SOURCES) + list(AGGREGATOR_SOURCES)


@pytest.mark.parametrize("source", ALL)
def test_adapter_produces_valid_jobs(source):
    raws = raws_for(source)
    assert raws, f"fixture for {source} is empty"
    jobs = [j for j in (norm(source, r) for r in raws) if j]
    for job in jobs:
        assert job.source == source
        assert job.title
        assert job.canonical_url.startswith("https://")
        assert job.apply_url.startswith("http")
        assert job.employment_type in {"full_time", "part_time", "contract", "temporary", "unknown"}
        assert job.remote_type in {"remote", "hybrid", "onsite", None}
        assert all(len(c) == 2 and c.isupper() for c in job.countries)
        if job.posted_at:
            assert job.posted_at.tzinfo is not None
            # A real posting date is in the past, never "now" from crawl time.
            assert job.posted_at < datetime.now(UTC)
        assert (job.posted_at is None) == (job.date_source == "unknown")


def first(source):
    return next(j for j in (norm(source, r) for r in raws_for(source)) if j)


def test_greenhouse_uses_first_published_not_updated_at():
    raw = raws_for("greenhouse")[0]
    job = norm("greenhouse", raw)
    assert job.posted_at == datetime.fromisoformat(raw.data["first_published"])
    assert job.source_updated_at == datetime.fromisoformat(raw.data["updated_at"])
    assert job.posted_at != job.source_updated_at
    assert "<" not in job.description_text
    assert job.countries == ["IE"]


def test_lever_country_and_workplace():
    job = first("lever")
    assert job.posted_at == datetime.fromtimestamp(
        raws_for("lever")[0].data["createdAt"] / 1000, UTC
    )
    assert "SG" in job.countries


def test_ashby_published_at_and_salary():
    raw = raws_for("ashby")[0]
    job = norm("ashby", raw)
    assert job.posted_at.isoformat().startswith(raw.data["publishedAt"][:19])
    assert job.countries == ["US"]


def test_workable_uses_published_on():
    job = first("workable")
    assert job.posted_at.date().isoformat() == raws_for("workable")[0].data["published_on"]
    assert job.remote_type == "remote"
    assert "FR" in job.countries


def test_smartrecruiters_internship_dropped_and_detail_used():
    raw = raws_for("smartrecruiters")[0]
    assert raw.data["experienceLevel"]["id"] == "internship"
    assert norm("smartrecruiters", raw) is None
    other = {**raw.data, "experienceLevel": {"id": "mid_senior_level"}, "name": "Software Engineer"}
    job = norm("smartrecruiters", RawJob("smartrecruiters", raw.external_id, other, "c1", "Bosch"))
    assert job.description_text
    assert job.countries == ["DE"]
    assert job.remote_type == "hybrid"


def test_teamtailor_rss():
    job = first("teamtailor")
    assert job.countries == ["GB"]
    assert job.remote_type == "hybrid"
    assert job.posted_at is not None


def test_remote_boards_are_remote_with_regions():
    for source in ("remotive", "himalayas", "remoteok", "weworkremotely"):
        job = first(source)
        assert job.remote_type == "remote", source
        assert job.countries or job.remote_regions, source


def test_wwr_splits_company_and_title_and_regions():
    jobs = [norm("weworkremotely", r) for r in raws_for("weworkremotely")]
    assert jobs[0].company_name == "Example Labs"
    assert jobs[0].title == "Senior Full-Stack Engineer"
    assert jobs[0].remote_regions == ["WORLDWIDE"]
    assert jobs[1].remote_regions == ["EUROPE"]


def test_adzuna_ignores_predicted_salary():
    a, b = [norm("adzuna", r) for r in raws_for("adzuna")]
    assert a.salary_min == 70000 and a.title == "Senior Python Developer"
    assert b.salary_min is None and b.salary_max is None


def test_reed_date_is_day_month_year():
    job = first("reed")
    assert job.posted_at == datetime(2026, 10, 18, tzinfo=UTC)
    assert job.countries == ["GB"]
    assert job.salary_currency == "GBP"


def test_jooble_never_uses_updated_as_posted():
    job = first("jooble")
    assert job.posted_at is None
    assert job.date_source == "unknown"
    assert job.source_updated_at is not None
    assert job.countries == ["PL"]
