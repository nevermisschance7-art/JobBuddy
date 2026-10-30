"""Lists the models each provider offers right now, and checks the ones in models.json.

Usage: cd workers && uv run python -m jobbuddy_workers.llm.list_models
Keys are read from env (or workers/.env): GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY.
OpenRouter's list is public, so it works without a key.
"""

from __future__ import annotations

import os
import sys

import httpx
from dotenv import load_dotenv

from .config import load_config


def _gemini(key: str) -> list[str]:
    res = httpx.get(
        "https://generativelanguage.googleapis.com/v1beta/models",
        params={"pageSize": 1000},
        headers={"x-goog-api-key": key},
        timeout=30,
    )
    res.raise_for_status()
    return [
        m["name"].removeprefix("models/")
        for m in res.json().get("models", [])
        if "generateContent" in m.get("supportedGenerationMethods", [])
    ]


def _openai_models(base: str):
    def fetch(key: str) -> list[str]:
        res = httpx.get(f"{base}/models", headers={"Authorization": f"Bearer {key}"}, timeout=30)
        res.raise_for_status()
        return [m["id"] for m in res.json().get("data", [])]

    return fetch


def _first(name: str) -> str | None:
    """A NAME_API_KEY env value may list several keys, comma-separated: check the first."""
    raw = os.environ.get(f"{name.upper()}_API_KEY") or ""
    return raw.split(",")[0].strip() or None


def _groq(key: str) -> list[str]:
    res = httpx.get(
        "https://api.groq.com/openai/v1/models",
        headers={"Authorization": f"Bearer {key}"},
        timeout=30,
    )
    res.raise_for_status()
    return [m["id"] for m in res.json().get("data", [])]


def _openrouter_free() -> list[str]:
    res = httpx.get("https://openrouter.ai/api/v1/models", timeout=60)
    res.raise_for_status()
    return [m["id"] for m in res.json().get("data", []) if m["id"].endswith(":free")]


def main() -> int:
    load_dotenv()
    config = load_config()
    sources = {
        "gemini": (_first("gemini"), _gemini),
        "groq": (_first("groq"), _groq),
        "cerebras": (_first("cerebras"), _openai_models("https://api.cerebras.ai/v1")),
        "mistral": (_first("mistral"), _openai_models("https://api.mistral.ai/v1")),
        "openrouter": ("public", lambda _k: _openrouter_free()),
    }
    problems = 0
    for name, (key, fetch) in sources.items():
        print(f"\n== {name} ==")
        if not key:
            print(f"  skipped: set {name.upper()}_API_KEY to check")
            continue
        try:
            available = fetch(key)
        except Exception as e:  # noqa: BLE001
            print(f"  could not list models: {e}")
            problems += 1
            continue
        print(f"  {len(available)} models available")
        for model in config["providers"][name]["models"]:
            ok = model in available
            problems += 0 if ok else 1
            print(f"  {'OK ' if ok else 'MISSING'} {model}")
        if name == "openrouter":
            for model in sorted(available):
                print(f"     {model}")
    print("\nAll configured models exist." if problems == 0 else f"\n{problems} problem(s).")
    return 0 if problems == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
