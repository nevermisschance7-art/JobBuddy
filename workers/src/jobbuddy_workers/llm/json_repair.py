"""Pull a JSON value out of model output. Mirrors json-repair.ts."""

import json
import re
from typing import Any

_INVISIBLE = re.compile("[​-‍⁠﻿­]")
_FENCE = re.compile(r"```(?:json|JSON)?\s*([\s\S]*?)```")


def strip_to_json(raw: str) -> str:
    s = _INVISIBLE.sub("", raw).strip()
    fence = _FENCE.search(s)
    if fence and fence.group(1):
        s = fence.group(1).strip()
    m = re.search(r"[{\[]", s)
    if not m:
        return s
    start = m.start()
    close = "}" if s[start] == "{" else "]"
    end = s.rfind(close)
    return s[start : end + 1] if end > start else s[start:]


def parse_loose_json(raw: str) -> Any:
    """Parse model output as JSON. Raises ValueError if it still isn't valid."""
    return json.loads(strip_to_json(raw))
