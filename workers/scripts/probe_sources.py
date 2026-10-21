"""Fetch a small real sample from each job source, save it as a test fixture and print the
date-like fields each one has. Used to write SOURCES.md and keep fixtures realistic.

Usage: cd workers && uv run python scripts/probe_sources.py [source ...]
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

FIXTURES = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "sources"
UA = "JobBuddy/0.1 (+https://github.com/nevermisschance7-art/JobBuddy; job-hunt assistant)"
DATE_KEY = re.compile(r"date|time|created|updated|published|posted|released|_at$|At$|epoch", re.I)


def get(url: str, **kw: Any) -> httpx.Response:
    headers = {"User-Agent": UA, **kw.pop("headers", {})}
    res = httpx.get(url, headers=headers, timeout=60, follow_redirects=True, **kw)
    res.raise_for_status()
    return res


def keep_first(data: Any, path: list[str] | None, n: int = 3) -> Any:
    """Trim the list at `path` (or the top-level list) to n items."""
    if path is None:
        return data[:n] if isinstance(data, list) else data
    node = data
    for key in path[:-1]:
        node = node[key]
    node[path[-1]] = node[path[-1]][:n]
    return data


def date_fields(obj: Any, prefix: str = "") -> dict[str, Any]:
    out: dict[str, Any] = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            p = f"{prefix}.{k}" if prefix else k
            if DATE_KEY.search(k) and not isinstance(v, (dict, list)):
                out[p] = v
            elif isinstance(v, dict):
                out.update(date_fields(v, p))
    return out


def first_item(data: Any, path: list[str] | None) -> Any:
    node = data
    for key in path or []:
        node = node[key]
    return node[0] if isinstance(node, list) and node else node


def probe_json(name: str, url: str, path: list[str] | None, **kw: Any) -> None:
    data = get(url, **kw).json()
    data = keep_first(data, path)
    (FIXTURES / f"{name}.json").write_text(
        json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"\n== {name} ==  {url}")
    print(json.dumps(date_fields(first_item(data, path)), indent=2))


def probe_rss(name: str, url: str) -> None:
    text = get(url).text
    items = re.findall(r"<item>.*?</item>", text, re.S)[:3]
    head = text.split("<item>")[0]
    (FIXTURES / f"{name}.xml").write_text(
        head + "".join(items) + "</channel></rss>\n", encoding="utf-8"
    )
    print(f"\n== {name} ==  {url}")
    for tag in ["pubDate", "dc:date", "updated", "published"]:
        m = re.search(rf"<{tag}>(.*?)</{tag}>", items[0] if items else "")
        if m:
            print(f"  {tag}: {m.group(1)}")


def main(only: list[str]) -> None:
    load_dotenv()
    FIXTURES.mkdir(parents=True, exist_ok=True)
    probes = {
        "greenhouse": lambda: probe_json(
            "greenhouse",
            "https://boards-api.greenhouse.io/v1/boards/stripe/jobs?content=true",
            ["jobs"],
        ),
        "lever": lambda: probe_json(
            "lever", "https://api.lever.co/v0/postings/palantir?mode=json", None
        ),
        "ashby": lambda: probe_json(
            "ashby",
            "https://api.ashbyhq.com/posting-api/job-board/openai?includeCompensation=true",
            ["jobs"],
        ),
        "workable": lambda: probe_json(
            "workable",
            "https://apply.workable.com/api/v1/widget/accounts/huggingface?details=true",
            ["jobs"],
        ),
        "smartrecruiters": lambda: probe_json(
            "smartrecruiters",
            "https://api.smartrecruiters.com/v1/companies/BoschGroup/postings?limit=3",
            ["content"],
        ),
        "teamtailor": lambda: probe_rss("teamtailor", "https://career.teamtailor.com/jobs.rss"),
        "remotive": lambda: probe_json(
            "remotive",
            "https://remotive.com/api/remote-jobs?category=software-dev&limit=3",
            ["jobs"],
        ),
        "himalayas": lambda: probe_json(
            "himalayas", "https://himalayas.app/jobs/api?limit=3", ["jobs"]
        ),
        "arbeitnow": lambda: probe_json(
            "arbeitnow", "https://www.arbeitnow.com/api/job-board-api", ["data"]
        ),
        "remoteok": lambda: probe_json("remoteok", "https://remoteok.com/api", None),
        "weworkremotely": lambda: probe_rss(
            "weworkremotely",
            "https://weworkremotely.com/categories/remote-programming-jobs.rss",
        ),
    }
    if os.environ.get("ADZUNA_APP_ID") and os.environ.get("ADZUNA_APP_KEY"):
        probes["adzuna"] = lambda: probe_json(
            "adzuna",
            "https://api.adzuna.com/v1/api/jobs/gb/search/1",
            ["results"],
            params={
                "app_id": os.environ["ADZUNA_APP_ID"],
                "app_key": os.environ["ADZUNA_APP_KEY"],
                "results_per_page": 3,
                "category": "it-jobs",
            },
        )
    if os.environ.get("REED_API_KEY"):
        probes["reed"] = lambda: probe_json(
            "reed",
            "https://www.reed.co.uk/api/1.0/search?keywords=developer&resultsToTake=3",
            ["results"],
            auth=(os.environ["REED_API_KEY"], ""),
        )
    if os.environ.get("JOOBLE_API_KEY"):

        def jooble() -> None:
            res = httpx.post(
                f"https://jooble.org/api/{os.environ['JOOBLE_API_KEY']}",
                json={"keywords": "software engineer", "location": "", "page": 1},
                headers={"User-Agent": UA},
                timeout=60,
            )
            res.raise_for_status()
            data = keep_first(res.json(), ["jobs"])
            (FIXTURES / "jooble.json").write_text(
                json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
            )
            print("\n== jooble ==")
            print(json.dumps(date_fields(first_item(data, ["jobs"])), indent=2))

        probes["jooble"] = jooble

    for name, probe in probes.items():
        if only and name not in only:
            continue
        try:
            probe()
        except Exception as e:  # noqa: BLE001
            print(f"\n== {name} ==  FAILED: {e}")


if __name__ == "__main__":
    main(sys.argv[1:])
