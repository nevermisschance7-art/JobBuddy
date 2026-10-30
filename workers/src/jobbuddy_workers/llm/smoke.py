"""Calls every configured model once with a tiny JSON prompt and prints what happened.

Usage: cd workers && uv run python -m jobbuddy_workers.llm.smoke
Keys from env: GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY. Never prints keys.
"""

from __future__ import annotations

import os
import sys
import time

from dotenv import load_dotenv

from .config import load_config
from .json_repair import parse_loose_json
from .providers import PROVIDERS
from .types import LlmError, LlmRequest

PROMPT = 'Return {"ok": true, "word": "<any short English word>"} as JSON.'


def main() -> int:
    load_dotenv()
    config = load_config()
    failures = 0
    for name in config["order"]:
        pcfg = config["providers"][name]
        # Several keys may be listed, comma-separated: the first is checked.
        key = (os.environ.get(f"{name.upper()}_API_KEY") or "").split(",")[0].strip()
        print(f"\n== {name} ==")
        if not pcfg.get("enabled"):
            print("  disabled in models.json")
            continue
        if not key:
            print(f"  skipped: no {name.upper()}_API_KEY")
            continue
        for model in pcfg["models"]:
            started = time.monotonic()
            req = LlmRequest(
                model=model, prompt=PROMPT, json=True, temperature=0, max_output_tokens=200
            )
            try:
                res = PROVIDERS[name].generate(key, req)
                parsed = parse_loose_json(res.text)
                print(f"  OK      {model} ({time.monotonic() - started:.1f}s): {parsed}")
            except LlmError as e:
                failures += 1
                print(f"  {e.kind.upper():7} {model}: {str(e)[:300]}")
            except Exception as e:  # noqa: BLE001
                failures += 1
                print(f"  ERROR   {model}: {type(e).__name__}: {str(e)[:300]}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
