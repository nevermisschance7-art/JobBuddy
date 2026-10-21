"""Polite HTTP: a clear User-Agent, retries with exponential backoff, robots.txt for pages."""

from __future__ import annotations

import logging
import random
import time
from typing import Any
from urllib import robotparser
from urllib.parse import urlsplit

import httpx

log = logging.getLogger(__name__)

USER_AGENT = (
    "JobBuddy/0.1 (+https://github.com/nevermisschance7-art/JobBuddy; "
    "free job-hunt assistant; contact via GitHub issues)"
)
RETRY_STATUS = {429, 500, 502, 503, 504}


class FetchError(Exception):
    pass


class Http:
    def __init__(self, timeout: float = 30.0, retries: int = 3, backoff: float = 2.0):
        self.client = httpx.Client(
            headers={"User-Agent": USER_AGENT, "Accept": "application/json, */*"},
            timeout=timeout,
            follow_redirects=True,
        )
        self.retries = retries
        self.backoff = backoff
        self._robots: dict[str, robotparser.RobotFileParser | None] = {}

    def close(self) -> None:
        self.client.close()

    def request(self, method: str, url: str, **kw: Any) -> httpx.Response:
        last: Exception | None = None
        for attempt in range(self.retries + 1):
            try:
                res = self.client.request(method, url, **kw)
            except httpx.HTTPError as e:
                last = e
            else:
                if res.status_code not in RETRY_STATUS:
                    return res
                last = FetchError(f"{res.status_code} from {url}")
                retry_after = res.headers.get("retry-after", "")
                if retry_after.isdigit() and attempt < self.retries:
                    time.sleep(min(int(retry_after), 60))
                    continue
            if attempt < self.retries:
                time.sleep(self.backoff * (2**attempt) + random.random())
        raise FetchError(str(last))

    def get_json(self, url: str, **kw: Any) -> Any:
        res = self.request("GET", url, **kw)
        if res.status_code == 404:
            raise FetchError(f"404 from {url}")
        res.raise_for_status()
        return res.json()

    def post_json(self, url: str, body: Any, **kw: Any) -> Any:
        res = self.request("POST", url, json=body, **kw)
        res.raise_for_status()
        return res.json()

    def get_text(self, url: str, respect_robots: bool = True, **kw: Any) -> str:
        if respect_robots and not self.allowed(url):
            raise FetchError(f"robots.txt disallows {url}")
        res = self.request("GET", url, **kw)
        res.raise_for_status()
        return res.text

    def allowed(self, url: str) -> bool:
        """robots.txt check for page/feed URLs (APIs are used under their own terms)."""
        parts = urlsplit(url)
        host = f"{parts.scheme}://{parts.netloc}"
        if host not in self._robots:
            rp: robotparser.RobotFileParser | None = robotparser.RobotFileParser()
            try:
                res = self.client.get(f"{host}/robots.txt", timeout=15)
                if res.status_code >= 400:
                    rp = None  # no robots.txt: allowed
                else:
                    rp.parse(res.text.splitlines())  # type: ignore[union-attr]
            except httpx.HTTPError:
                rp = None
            self._robots[host] = rp
        rp = self._robots[host]
        return True if rp is None else rp.can_fetch(USER_AGENT, url)
