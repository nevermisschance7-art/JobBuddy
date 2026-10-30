from datetime import UTC, datetime, timedelta

import pytest

from jobbuddy_workers.embed import FakeEmbedder
from jobbuddy_workers.match.cv import cv_skills, cv_text
from jobbuddy_workers.match.rules import (
    JobFacts,
    UserFilters,
    evaluate,
    hard_filters,
    is_hot,
    mentions,
    office_days,
    says_no_sponsorship,
    top_reasons,
)
from jobbuddy_workers.match.run import UserContext, run_matcher

NOW = datetime(2026, 10, 21, 12, 0, tzinfo=UTC)


def job(**kw):
    base = dict(
        id="j1",
        title="Senior Backend Engineer",
        company_name="Acme",
        countries=["DE"],
        remote_regions=[],
        remote_type="hybrid",
        employment_type="full_time",
        seniority="senior",
        description_text="We build APIs in Python and PostgreSQL. 2 days a week in the office.",
        posted_at=NOW - timedelta(hours=5),
        similarity=0.62,
    )
    base.update(kw)
    return JobFacts(**base)


def filters(**kw):
    base = dict(countries_allowed=["DE"], seniority_levels=["senior"], must_have_skills=["Python"])
    base.update(kw)
    return UserFilters(**base)


# ---------------------------------------------------------------- text checks


@pytest.mark.parametrize(
    "text",
    [
        "We are unable to sponsor visas for this role.",
        "We do not offer visa sponsorship.",
        "Candidates must have the right to work in the UK.",
        "You must be able to work without sponsorship.",
        "Sponsorship is not available.",
    ],
)
def test_no_sponsorship_phrases(text):
    assert says_no_sponsorship(text)


@pytest.mark.parametrize(
    "text",
    [
        "Visa sponsorship is available.",
        "We build payments infrastructure.",
        "We can sponsor visas.",
    ],
)
def test_sponsorship_ok_phrases(text):
    assert not says_no_sponsorship(text)


def test_office_days():
    assert office_days("2 days a week in the office") == 2
    assert office_days("three days per week in our office") == 3
    assert office_days("In office 4 days") == 4
    assert office_days("Fully flexible") is None


def test_mentions_handles_symbols():
    assert mentions("We use C++ and C#", "C++")
    assert mentions("We use C++ and C#", "c#")
    assert mentions("Node.js backend", "Node.js")
    assert not mentions("JavaScript", "Java")
    assert not mentions("Golang", "Go")


# ---------------------------------------------------------------- each hard filter


def test_passes_when_everything_fits():
    assert hard_filters(job(), filters()) == []


def test_location_filter():
    assert "location" in hard_filters(job(countries=["US"]), filters())
    remote_eu = job(countries=[], remote_regions=["EUROPE"], remote_type="remote")
    assert hard_filters(remote_eu, filters(countries_allowed=["PL"], seniority_levels=[])) == []
    assert "location" in hard_filters(
        remote_eu, filters(countries_allowed=["US"], seniority_levels=[])
    )
    open_remote = job(countries=[], remote_type="remote")
    assert "location" not in hard_filters(open_remote, filters(countries_allowed=["BR"]))


def test_sponsorship_filter():
    j = job(description_text="Python. We are unable to sponsor visas.")
    assert "no_sponsorship" in hard_filters(j, filters(needs_sponsorship=True))
    assert "no_sponsorship" not in hard_filters(j, filters(needs_sponsorship=False))


def test_remote_type_and_office_days():
    assert "remote_type" in hard_filters(
        job(remote_type="onsite"), filters(remote_types=["remote"])
    )
    assert "office_days" in hard_filters(job(), filters(hybrid_max_office_days=1))
    assert "office_days" not in hard_filters(job(), filters(hybrid_max_office_days=2))


def test_seniority_filter_ignores_unknown():
    assert "seniority" in hard_filters(job(seniority="junior"), filters())
    assert "seniority" not in hard_filters(job(seniority="unknown"), filters())


def test_excluded_skills_companies_and_types():
    assert "excluded_skill" in hard_filters(job(), filters(excluded_skills=["PostgreSQL"]))
    assert "excluded_company" in hard_filters(
        job(company_name="ACME Inc."), filters(excluded_companies=["acme"])
    )
    assert "employment_type" in hard_filters(job(employment_type="contract"), filters())
    assert "employment_type" not in hard_filters(job(employment_type="unknown"), filters())


# ---------------------------------------------------------------- scoring maths


def test_score_is_tech_fit_only():
    r = evaluate(job(), filters(), NOW)
    assert r.passed
    assert r.score == round(r.breakdown["technical"]["points"])
    # Other parts stay as information for the job card but never change the score.
    worse_info = evaluate(job(posted_at=None, salary_max=None, seniority="unknown"), filters(), NOW)
    assert worse_info.score == r.score
    for name, limit in {
        "technical": 100,
        "seniority": 20,
        "eligibility": 20,
        "freshness": 10,
    }.items():
        assert 0 <= r.breakdown[name]["points"] <= limit
        assert r.breakdown[name]["reason"]


def test_unknown_info_never_gets_full_points():
    r = evaluate(
        job(seniority="unknown", remote_type=None, posted_at=None, countries=[], remote_regions=[]),
        filters(countries_allowed=[]),
        NOW,
    )
    assert r.breakdown["seniority"]["points"] < 20
    assert r.breakdown["remote"]["points"] < 10
    assert r.breakdown["freshness"]["points"] < 10
    assert r.breakdown["compensation"]["points"] < 5
    assert r.breakdown["eligibility"]["points"] < 20


def test_freshness_steps():
    pts = [
        evaluate(job(posted_at=NOW - age), filters(), NOW).breakdown["freshness"]["points"]
        for age in (timedelta(hours=2), timedelta(hours=50), timedelta(days=7), timedelta(days=30))
    ]
    assert pts == [10, 8, 5, 2]


def test_compensation():
    def comp(**kw):
        return evaluate(
            job(**kw), filters(salary_floor=70000, salary_currency="EUR"), NOW
        ).breakdown["compensation"]["points"]

    assert comp(salary_max=90000, salary_currency="EUR") == 5
    assert comp(salary_max=50000, salary_currency="EUR") == 0
    assert comp() == 2


def test_ads_naming_few_technologies_fall_back_to_closeness():
    low = evaluate(job(similarity=0.30), filters(), NOW).score
    mid = evaluate(job(similarity=0.475), filters(), NOW).score
    high = evaluate(job(similarity=0.70), filters(), NOW).score
    assert low < mid < high
    assert low == 0
    assert high == 85


PYTHON_CV = {
    "basics": {"label": "Senior Backend Engineer", "summary": "Python backend engineer."},
    "work": [
        {"position": "Backend Engineer", "name": "Acme",
         "highlights": ["Built Python APIs with Django and PostgreSQL on AWS", "Python services"]},
    ],
    "skills": [
        {"name": "Backend", "keywords": ["Python", "Django", "PostgreSQL", "AWS", "Docker"]}
    ],
}  # fmt: skip


def tech_filters(**kw):
    from jobbuddy_workers.match.cv import cv_roles
    from jobbuddy_workers.match.tech import cv_terms

    kw.setdefault("must_have_skills", [])
    return filters(cv_terms=cv_terms(PYTHON_CV), cv_roles=cv_roles(PYTHON_CV), **kw)


def test_tech_fit_counts_the_jobs_technologies_you_have():
    strong = job(
        title="Senior Python Backend Engineer",
        description_text="You will build APIs in Python and Django on PostgreSQL and AWS. "
        "Docker every day. Nice to have: Kubernetes.",
        similarity=0.3,
    )
    other_stack = job(
        title="Senior Java Engineer",
        description_text="Java and Spring Boot services on Oracle, Kotlin a plus.",
        similarity=0.5,
    )
    r = evaluate(strong, tech_filters(), NOW)
    assert r.score >= 85, r.breakdown["technical"]
    assert "python" in str(r.breakdown["technical"]["reason"])
    assert evaluate(other_stack, tech_filters(), NOW).score < 25


def test_nice_to_have_counts_less_than_required():
    required = job(
        id="r", title="Backend Engineer", description_text="Python, Kubernetes and Kafka required."
    )
    nice = job(
        id="n",
        title="Backend Engineer",
        description_text="Python required. Nice to have: Kubernetes and Kafka.",
    )
    assert evaluate(nice, tech_filters(), NOW).score > evaluate(required, tech_filters(), NOW).score


def test_sponsorship_unknown_caps_eligibility():
    r = evaluate(job(), filters(needs_sponsorship=True), NOW)
    assert r.breakdown["eligibility"]["points"] == 12


def test_hot_match_and_top_reasons():
    r = evaluate(job(similarity=0.7, salary_max=100000, remote_type="hybrid"), filters(), NOW)
    assert r.score >= 85
    assert is_hot(r, job(), NOW)
    assert not is_hot(r, job(posted_at=NOW - timedelta(days=2)), NOW)
    assert len(top_reasons(r)) == 3


# ---------------------------------------------------------------- CV text


RESUME = {
    "basics": {"name": "Sam", "email": "sam@x.io", "label": "Backend Engineer", "summary": "APIs"},
    "work": [{"name": "Acme", "position": "Engineer", "highlights": ["Built billing in Python"]}],
    "skills": [{"name": "Backend", "keywords": ["Python", "PostgreSQL", "python"]}],
    "projects": [{"name": "Tool", "description": "CLI", "keywords": ["Go"]}],
}


def test_cv_text_has_no_contact_details():
    t = cv_text(RESUME)
    assert "Backend Engineer" in t and "Built billing" in t
    assert "sam@x.io" not in t and "Sam" not in t.split("\n")[0]


def test_cv_skills_dedupes():
    assert cv_skills(RESUME) == ["Python", "PostgreSQL", "Go"]


# ---------------------------------------------------------------- run


class Store:
    def __init__(self, user, jobs):
        self.user = user
        self._jobs = jobs
        self.saved = []
        self.removed = []
        self.events = []
        self.embeddings = []
        self.matched_at = None
        self.since = []

    def users(self):
        return [self.user]

    def save_cv_embedding(self, cv_id, e):
        self.embeddings.append(cv_id)

    def jobs(self, emb, since):
        self.since.append(since)
        return self._jobs

    def save_matches(self, user_id, rows):
        self.saved += rows

    def remove_matches(self, user_id, ids):
        self.removed += ids

    def set_matched_at(self, user_id, when):
        self.matched_at = when

    def last_run_started(self):
        return NOW - timedelta(hours=2)

    def start_run(self, s):
        return "r"

    def finish_run(self, *a):
        pass

    def events_today(self, user_id, t, since):
        return sum(1 for e in self.events if e[0] == t)

    def unsummarised_count(self, *a):
        return 7

    def last_event_at(self, *a):
        return None

    def add_event(self, user_id, t, payload):
        self.events.append((t, payload))


def make_user(**kw):
    base = dict(
        user_id="u1",
        min_score=55,
        time_zone="Europe/Berlin",
        alert_settings={"daily_summary_time": "09:00"},
        matched_at=None,
        filters=filters(),
        filters_updated_at=NOW - timedelta(days=1),
        cv_id="cv1",
        resume=RESUME,
        cv_embedding=None,
    )
    base.update(kw)
    return UserContext(**base)


def test_run_scores_stores_and_alerts():
    hot_jobs = [job(id=f"h{i}", similarity=0.7, salary_max=100000) for i in range(5)]
    jobs = [
        *hot_jobs,
        job(id="far", countries=["US"]),
        job(id="weak", similarity=0.0, seniority="unknown"),
    ]
    store = Store(make_user(), jobs)
    report = run_matcher(store, FakeEmbedder(), now=NOW)

    assert store.embeddings == ["cv1"]  # CV embedded once
    assert store.matched_at == NOW  # full rescore recorded
    saved = {r["job_id"] for r in store.saved}
    assert {"h0", "h1", "h2", "h3", "h4"} <= saved
    assert "far" in store.removed or "far" in saved  # failed location: stored only as a near miss
    assert [e[0] for e in store.events].count("hot_match") == 3  # max 3 a day
    assert (
        "daily_summary",
        {"new_matches": 7, "since": (NOW - timedelta(days=1)).isoformat()},
    ) in store.events
    assert report.users == 1


def test_incremental_run_only_scores_recent_jobs():
    user = make_user(cv_embedding=[0.1] * 384, matched_at=NOW - timedelta(hours=3))
    store = Store(user, [])
    run_matcher(store, FakeEmbedder(), now=NOW)
    assert store.embeddings == []
    assert store.since[0] > NOW - timedelta(days=1)
    assert store.matched_at is None


def test_filter_change_triggers_full_rescore():
    user = make_user(
        cv_embedding=[0.1] * 384,
        matched_at=NOW - timedelta(hours=3),
        filters_updated_at=NOW - timedelta(hours=1),
    )
    store = Store(user, [])
    run_matcher(store, FakeEmbedder(), now=NOW)
    assert store.since[0].year == 2000
    assert store.matched_at == NOW


def test_unrelated_jobs_score_low():
    far = evaluate(job(similarity=0.33, description_text="Salesforce admin work."), filters(), NOW)
    assert far.score < 20
    close = evaluate(job(similarity=0.62), filters(), NOW)
    assert close.score >= 85


def test_dedupe_ignores_company_spaces():
    from jobbuddy_workers.jobs.normalize import dedupe_key

    assert dedupe_key("Grafana Labs", "SRE", ["DE"]) == dedupe_key("grafanalabs", "SRE", ["DE"])


def test_eligibility_chip():
    def chip(j, f):
        return evaluate(j, f, NOW).breakdown["eligibility"]["chip"]

    assert chip(job(), filters()) == "indicated"
    assert chip(job(countries=[], remote_type="remote"), filters()) == "unclear"
    assert (
        chip(
            job(description_text="Visa sponsorship is available."), filters(needs_sponsorship=True)
        )
        == "sponsorship_stated"
    )
    assert chip(job(), filters(needs_sponsorship=True)) == "unclear"
    assert (
        chip(job(description_text="You must have the right to work in Germany."), filters())
        == "restriction"
    )


def test_remote_jobs_limited_to_another_country_are_opt_in():
    us_remote = job(countries=["US"], remote_type="remote", description_text="Python APIs.")
    poland = filters(countries_allowed=["PL"])
    assert "location" in hard_filters(us_remote, poland)

    opted_in = filters(countries_allowed=["PL"], remote_extra_countries=["US"])
    assert hard_filters(us_remote, opted_in) == []
    elig = evaluate(us_remote, opted_in, NOW).breakdown["eligibility"]
    assert elig["chip"] == "restriction"
    assert elig["points"] == 6
    assert "contractor" in elig["reason"]

    us_office = job(countries=["US"], remote_type="onsite")
    assert "location" in hard_filters(us_office, opted_in)  # only remote jobs, never office jobs


def test_must_have_skills_mean_any_one_of_them():
    ad = job(
        title="Python Developer",
        description_text="Python, Django, PostgreSQL, AWS and Docker.",
        similarity=0.5,
    )
    stack = ["Python", "PHP", "Laravel", "Azure"]  # a list of options, not all at once
    with_list = evaluate(ad, tech_filters(must_have_skills=stack), NOW).score
    assert with_list == evaluate(ad, tech_filters(), NOW).score
    other = job(title="Java Developer", description_text="Java and Spring Boot.", similarity=0.5)
    assert evaluate(other, tech_filters(must_have_skills=stack), NOW).score < 20


def test_a_different_kind_of_role_scores_low_even_with_few_technologies():
    ios = job(
        title="iOS Engineer - Creative App",
        description_text="Ship native features in Swift for our creative app.",
        similarity=0.55,
    )
    assert evaluate(ios, tech_filters(), NOW).score < 25


def test_a_non_developer_title_scores_lower():
    dev = job(id="d", title="Python Engineer", description_text="Python and SQL.", similarity=0.5)
    other = job(
        id="t", title="Talent Scientist", description_text="Python and SQL.", similarity=0.5
    )
    assert evaluate(other, tech_filters(), NOW).score < evaluate(dev, tech_filters(), NOW).score


def test_main_stack_follows_the_skills_order_not_mention_counts():
    from jobbuddy_workers.match.tech import cv_terms, main_stack

    cv = {
        "work": [{"highlights": ["Azure, Azure, Azure and Kafka, Kafka on Azure"]}],
        "skills": [
            {"name": "Languages", "keywords": ["PHP 8.4", "Python", "SQL"]},
            {"name": "Backend", "keywords": ["Laravel", "Symfony"]},
        ],
    }
    stack = main_stack(cv_terms(cv))
    assert "php" in stack and "laravel" in stack and "sql" not in stack


def test_remote_ad_that_says_us_only_counts_as_a_us_job():
    from jobbuddy_workers.match.rules import location_fit, says_us_only

    assert says_us_only("Candidates must reside in the United States.")
    assert says_us_only("This role is open only to applicants located in the U.S.")
    assert says_us_only("We hire from anywhere in the United States.")
    assert not says_us_only("We work with clients in the United States and Europe.")
    ad = job(
        countries=[],
        remote_regions=[],
        remote_type="remote",
        description_text="Fully remote. You must be located in the US to apply.",
    )
    assert location_fit(ad, ["GB"])[0] == "none"
    assert location_fit(ad, ["GB"], ["US"])[0] == "remote_abroad"
