from datetime import UTC, datetime, timedelta

from jobbuddy_workers.discover.run import KnownCompany, discover, pretty_name
from jobbuddy_workers.discover.slugs import slugs_in

NOW = datetime(2026, 10, 26, 3, 0, tzinfo=UTC)


def test_slugs_from_urls():
    text = """
    Apply: https://boards.greenhouse.io/acme/jobs/123 or https://job-boards.greenhouse.io/Beta
    https://jobs.lever.co/gamma/abc-123 https://jobs.eu.lever.co/delta/x
    https://jobs.ashbyhq.com/epsilon/uuid https://apply.workable.com/zeta/j/ABC123/
    https://jobs.smartrecruiters.com/BoschGroup/7440 https://eta.teamtailor.com/jobs/1-dev
    https://apply.workable.com/j/ABC123 https://jobs.lever.co/api https://www.teamtailor.com/
    """
    assert slugs_in(text) == {
        ("greenhouse", "acme"),
        ("greenhouse", "beta"),
        ("lever", "gamma"),
        ("lever", "eu:delta"),
        ("ashby", "epsilon"),
        ("workable", "zeta"),
        ("smartrecruiters", "BoschGroup"),
        ("teamtailor", "eta"),
    }


def test_pretty_name():
    assert pretty_name("hello-world") == "Hello World"
    assert pretty_name("eu:acme_labs") == "Acme Labs"
    assert pretty_name("BoschGroup") == "BoschGroup"


class Store:
    def __init__(self, companies, texts):
        self._companies = companies
        self._texts = texts
        self.inserted = []
        self.updates = {}

    def companies(self):
        return self._companies

    def job_link_texts(self):
        return self._texts

    def insert_companies(self, rows):
        self.inserted += rows

    def update_company(self, company_id, fields):
        self.updates.setdefault(company_id, {}).update(fields)


class FakeCrawl:
    def __init__(self, urls):
        self._urls = urls

    def urls(self, pattern):
        return [u for u in self._urls if pattern.split("/")[0].lstrip("*.") in u]


def checker(live):
    return lambda ats, slug: (slug in live, None, 3 if slug in live else 0)


def test_new_live_companies_are_added_once():
    store = Store(
        [KnownCompany("k1", "greenhouse", "acme", True, 0, NOW)],
        ["https://boards.greenhouse.io/acme/jobs/1 https://jobs.lever.co/newco/2"],
    )
    crawl = FakeCrawl(["https://jobs.ashbyhq.com/fresh/1", "https://jobs.ashbyhq.com/dead/1"])
    report = discover(store, checker({"newco", "fresh"}), crawl, now=NOW)
    added = {(r["ats"], r["slug"], r["discovered_via"]) for r in store.inserted}
    assert added == {("lever", "newco", "job_links"), ("ashby", "fresh", "common_crawl")}
    assert report.added == {"lever": 1, "ashby": 1}
    assert all(r["jobs_open"] == 3 for r in store.inserted)


def test_failing_companies_are_deactivated():
    store = Store(
        [
            KnownCompany("bad", "lever", "bad", True, 5, NOW),
            KnownCompany("ok", "lever", "ok", True, 4, NOW),
        ],
        [],
    )
    report = discover(store, checker(set()), None, now=NOW)
    assert store.updates["bad"]["active"] is False
    assert "ok" not in store.updates
    assert report.deactivated == 1


def test_inactive_companies_are_retried_monthly():
    store = Store(
        [
            KnownCompany("old", "ashby", "back", False, 6, NOW - timedelta(days=31)),
            KnownCompany("recent", "ashby", "back2", False, 6, NOW - timedelta(days=3)),
        ],
        [],
    )
    report = discover(store, checker({"back", "back2"}), None, now=NOW)
    assert store.updates["old"]["active"] is True
    assert store.updates["old"]["fail_count"] == 0
    assert "recent" not in store.updates
    assert report.reactivated == 1


def test_round_robin_mixes_systems():
    from jobbuddy_workers.discover.run import _round_robin

    new = {("greenhouse", f"g{i}"): "x" for i in range(5)} | {
        ("lever", "l1"): "x",
        ("ashby", "a1"): "x",
    }
    order = [k[0] for k, _ in _round_robin(new)[:3]]
    assert set(order) == {"greenhouse", "lever", "ashby"}
