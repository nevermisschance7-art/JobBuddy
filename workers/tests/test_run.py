"""The fetch pipeline end to end, with an in-memory store and fake sources."""

from datetime import UTC, datetime, timedelta

import pytest

from jobbuddy_workers.embed import FakeEmbedder
from jobbuddy_workers.jobs import run as run_module
from jobbuddy_workers.jobs.model import Job, RawJob
from jobbuddy_workers.jobs.run import Runner, is_relevant
from jobbuddy_workers.jobs.sources import Company
from jobbuddy_workers.jobs.store import MemoryStore


def make_job(source, ext, title="Backend Engineer", company="Acme", countries=("DE",), **kw):
    return Job(
        source=source,
        external_id=ext,
        canonical_url=f"https://{source}.example/{ext}",
        apply_url=f"https://{source}.example/{ext}/apply",
        title=title,
        company_name=company,
        description_text=kw.pop("description", "Build APIs in Python."),
        countries=list(countries),
        remote_regions=kw.pop("regions", []),
        locations=[],
        remote_type=kw.pop("remote_type", "remote"),
        employment_type="full_time",
        seniority="unknown",
        posted_at=kw.pop("posted_at", datetime.now(UTC) - timedelta(hours=3)),
        **kw,
    )


class FakeEmployer:
    name = "greenhouse"
    kind = "employer"

    def __init__(self):
        self.listings: dict[str, list[Job] | Exception] = {}

    def fetch_company(self, http, company):
        listing = self.listings[company.slug]
        if isinstance(listing, Exception):
            raise listing
        return [RawJob(self.name, j.external_id, j, company.id, company.name) for j in listing]

    def normalise(self, raw):
        return raw.data


class FakeAggregator:
    name = "remotive"
    kind = "aggregator"
    every_hours = 2

    def __init__(self, jobs):
        self.jobs = jobs

    def available(self, ctx):
        return True

    def fetch(self, http, ctx):
        return [RawJob(self.name, j.external_id, j) for j in self.jobs]

    def normalise(self, raw):
        return raw.data


@pytest.fixture
def setup(monkeypatch):
    employer = FakeEmployer()
    aggregator = FakeAggregator([])
    monkeypatch.setattr(run_module, "EMPLOYER_SOURCES", {"greenhouse": employer})
    monkeypatch.setattr(run_module, "AGGREGATOR_SOURCES", {"remotive": aggregator})
    store = MemoryStore(companies=[Company("c1", "Acme", "greenhouse", "acme")], countries={"DE"})
    runner = Runner(store, http=None, embedder=FakeEmbedder(), env={})
    return store, runner, employer, aggregator


def test_new_jobs_are_stored_with_embeddings(setup):
    store, runner, employer, _ = setup
    employer.listings["acme"] = [
        make_job("greenhouse", "1"),
        make_job("greenhouse", "2", title="Data Engineer"),
    ]
    stats = runner.run(hour=0)["greenhouse"]
    assert stats.new == 2
    row = store.jobs[("greenhouse", "1")]
    assert row["embedding"].startswith("[") and row["embedding"].count(",") == 383
    assert row["date_source"] == "source_field"
    assert row["dedupe_key"] == "acme|backend engineer|DE"


def test_unchanged_jobs_are_not_re_embedded(setup):
    store, runner, employer, _ = setup
    employer.listings["acme"] = [make_job("greenhouse", "1")]
    runner.run(hour=0)
    stats = runner.run(hour=0)["greenhouse"]
    assert stats.new == 0 and stats.updated == 0

    employer.listings["acme"] = [make_job("greenhouse", "1", description="Now with Go too.")]
    assert runner.run(hour=0)["greenhouse"].updated == 1


def test_job_closes_after_two_missed_runs(setup):
    store, runner, employer, _ = setup
    employer.listings["acme"] = [
        make_job("greenhouse", "1"),
        make_job("greenhouse", "2", title="SRE"),
    ]
    runner.run(hour=0)
    employer.listings["acme"] = [make_job("greenhouse", "1")]
    runner.run(hour=0)
    assert store.jobs[("greenhouse", "2")].get("closed_at") is None
    stats = runner.run(hour=0)["greenhouse"]
    assert stats.closed == 1
    assert store.jobs[("greenhouse", "2")]["closed_at"] is not None


def test_failed_company_fetch_does_not_close_its_jobs(setup):
    store, runner, employer, _ = setup
    employer.listings["acme"] = [make_job("greenhouse", "1")]
    runner.run(hour=0)
    employer.listings["acme"] = RuntimeError("board down")
    runner.run(hour=0)
    runner.run(hour=0)
    assert store.jobs[("greenhouse", "1")].get("closed_at") is None
    assert ("c1", False) in store.company_log


def test_aggregator_duplicate_of_employer_job_is_skipped(setup):
    store, runner, employer, aggregator = setup
    employer.listings["acme"] = [make_job("greenhouse", "1", title="Senior Backend Engineer")]
    aggregator.jobs = [
        make_job("remotive", "r1", title="Senior Backend Engineer", company="ACME Inc."),
        make_job("remotive", "r2", title="Frontend Developer", company="Other"),
    ]
    results = runner.run(hour=0)
    assert results["remotive"].new == 1
    assert ("remotive", "r1") not in store.jobs
    assert ("remotive", "r2") in store.jobs


def test_aggregators_only_run_when_due(setup):
    _, runner, employer, aggregator = setup
    employer.listings["acme"] = []
    aggregator.every_hours = 6
    assert "remotive" not in runner.run(hour=2)
    assert "remotive" in runner.run(hour=6)


def test_relevance_is_fresh_remote_tech_jobs_only():
    now = datetime(2026, 10, 27, 12, tzinfo=UTC)
    fresh = make_job("x", "1", posted_at=now - timedelta(days=6))
    assert is_relevant(fresh, set(), now=now)
    assert not is_relevant(make_job("x", "2", remote_type="hybrid", posted_at=now), set(), now=now)
    assert not is_relevant(make_job("x", "3", remote_type=None, posted_at=now), set(), now=now)
    assert not is_relevant(make_job("x", "4", posted_at=now - timedelta(days=8)), set(), now=now)
    assert not is_relevant(
        make_job("x", "5", posted_at=None), set(), now=now
    )  # no proof it is fresh
    assert not is_relevant(
        make_job("x", "6", title="Account Executive", posted_at=now), set(), now=now
    )


class FakeDetailSource(FakeEmployer):
    """Like SmartRecruiters: the listing lacks descriptions; details cost a request each."""

    name = "greenhouse"

    def __init__(self):
        super().__init__()
        self.detail_calls = 0

    def wants_detail(self, raw):
        return True

    def fetch_detail(self, http, raw):
        self.detail_calls += 1
        return raw


def test_details_only_for_relevant_new_jobs_and_capped(setup, monkeypatch):
    store, runner, _, _ = setup
    src = FakeDetailSource()
    monkeypatch.setattr(run_module, "EMPLOYER_SOURCES", {"greenhouse": src})
    monkeypatch.setattr(run_module, "MAX_DETAILS_PER_RUN", 2)
    src.listings["acme"] = [
        make_job("greenhouse", "1"),
        make_job("greenhouse", "2", title="Data Engineer"),
        make_job("greenhouse", "3", title="SRE"),
        make_job("greenhouse", "far", remote_type="onsite"),  # not relevant: no detail fetched
    ]
    first = runner.run(hour=0)["greenhouse"]
    assert src.detail_calls == 2
    assert first.new == 2  # the third waits for the next run, it is not stored without details

    second = runner.run(hour=0)["greenhouse"]
    assert src.detail_calls == 3  # only the one still missing
    assert second.new == 1
    assert ("greenhouse", "far") not in store.jobs


def test_company_results_are_recorded_in_one_batch(setup):
    store, runner, employer, _ = setup
    employer.listings["acme"] = [make_job("greenhouse", "1")]
    runner.run(hour=0)
    assert store.company_log == [("c1", True)]


def test_a_crashing_source_does_not_stop_the_others(setup, monkeypatch):
    store, runner, employer, aggregator = setup
    employer.listings["acme"] = [make_job("greenhouse", "1")]
    aggregator.jobs = [make_job("remotive", "r1", title="Frontend Developer", company="Other")]

    def boom(rows):
        raise RuntimeError("database down")

    monkeypatch.setattr(store, "upsert_jobs", boom)
    results = runner.run(hour=0)
    assert results["greenhouse"].errors and results["remotive"].errors  # both ran, both reported
