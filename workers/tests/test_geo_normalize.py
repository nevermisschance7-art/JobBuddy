import pytest

from jobbuddy_workers.geo import country_code, parse_location, region_covers
from jobbuddy_workers.jobs.normalize import (
    canonical_url,
    dedupe_key,
    employment_from,
    html_to_text,
    is_internship,
    is_tech_role,
    remote_type_from,
    seniority_from,
)


@pytest.mark.parametrize(
    ("text", "countries", "regions", "remote"),
    [
        ("Dublin", {"IE"}, set(), False),
        ("New York, NY", {"US"}, set(), False),
        ("Austin, TX", {"US"}, set(), False),
        ("Toronto, ON", {"CA"}, set(), False),
        ("Ludwigsburg, BW, Germany", {"DE"}, set(), False),
        ("Singapore, Singapore", {"SG"}, set(), False),
        ("Remote - US", {"US"}, set(), True),
        ("Remote (EMEA)", set(), {"EMEA"}, True),
        ("Anywhere in the World", set(), {"WORLDWIDE"}, True),
        ("Europe Only", set(), {"EUROPE"}, False),
        ("São Paulo, Brazil", {"BR"}, set(), False),
        ("Bengaluru, Karnataka, India", {"IN"}, set(), False),
        ("London or Berlin", {"GB", "DE"}, set(), False),
        ("", set(), set(), False),
    ],
)
def test_parse_location(text, countries, regions, remote):
    c, r, rem = parse_location(text)
    assert c == countries
    assert r == regions
    assert rem == remote


def test_country_code_aliases():
    assert country_code("United Kingdom") == "GB"
    assert country_code("UK") == "GB"
    assert country_code("de") == "DE"
    assert country_code("Deutschland") == "DE"
    assert country_code("USA") == "US"
    assert country_code("Atlantis") is None


def test_region_covers():
    assert region_covers("WORLDWIDE", "BR")
    assert region_covers("EUROPE", "PL")
    assert not region_covers("EUROPE", "US")
    assert region_covers("EMEA", "AE")


def test_html_to_text_handles_escaped_html():
    text = html_to_text("&lt;h2&gt;Role&lt;/h2&gt;&lt;ul&gt;&lt;li&gt;Python&lt;/li&gt;&lt;/ul&gt;")
    assert text == "Role\n\n- Python"


def test_tech_roles():
    assert is_tech_role("Senior Backend Engineer")
    assert is_tech_role("Data Scientist")
    assert is_tech_role("iOS Developer")
    assert not is_tech_role("Account Executive")
    assert not is_tech_role("Sales Engineer")
    assert not is_tech_role("Office Manager")


def test_internships_are_detected():
    assert is_internship("Software Engineering Intern")
    assert is_internship("Werkstudent Softwareentwicklung")
    assert is_internship("Engineer", "Internship")
    assert not is_internship("International Payments Engineer")


@pytest.mark.parametrize(
    ("title", "level"),
    [
        ("Senior Software Engineer", "senior"),
        ("Sr. Data Engineer", "senior"),
        ("Staff Engineer", "principal"),
        ("Engineering Manager", "lead"),
        ("Junior Developer", "junior"),
        ("Software Engineer II", "mid"),
        ("Software Engineer", "unknown"),
    ],
)
def test_seniority(title, level):
    assert seniority_from(title) == level


def test_employment_and_remote():
    assert employment_from("Full-time") == "full_time"
    assert employment_from("Contract") == "contract"
    assert employment_from(None) == "unknown"
    assert remote_type_from("on-site") == "onsite"
    assert remote_type_from("fully") == "remote"
    assert remote_type_from(None, "Hybrid - London") == "hybrid"
    assert remote_type_from(None, "Berlin") is None


def test_canonical_url_keeps_job_ids_only():
    assert (
        canonical_url("https://WWW.Stripe.com/jobs/search?gh_jid=123&utm_source=x/")
        == "https://stripe.com/jobs/search?gh_jid=123%2F"
        or canonical_url("https://WWW.Stripe.com/jobs/search?gh_jid=123&utm_source=x")
        == "https://stripe.com/jobs/search?gh_jid=123"
    )
    assert canonical_url("https://jobs.lever.co/acme/abc/") == "https://jobs.lever.co/acme/abc"


def test_dedupe_key_ignores_case_and_suffixes():
    assert dedupe_key("Acme Inc.", "Senior Engineer", ["DE"]) == dedupe_key(
        "ACME", "senior engineer", ["DE"]
    )
    assert dedupe_key("Acme", "Engineer", []).endswith("|REMOTE")
