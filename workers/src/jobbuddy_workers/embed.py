"""Text embeddings (384 dims, all-MiniLM-L6-v2), computed locally for free.

Uses fastembed (ONNX) rather than sentence-transformers: same model and vectors, but a
~50 MB install instead of ~800 MB of PyTorch, which keeps GitHub Actions runs short.
"""

from __future__ import annotations

import hashlib
import math
import os
from typing import Protocol

MODEL = "sentence-transformers/all-MiniLM-L6-v2"
DIMS = 384


class Embedder(Protocol):
    def embed(self, texts: list[str]) -> list[list[float]]: ...


class FastEmbedder:
    def __init__(self) -> None:
        from fastembed import TextEmbedding  # imported lazily: heavy

        self.model = TextEmbedding(MODEL, cache_dir=os.environ.get("FASTEMBED_CACHE_PATH"))

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [v.tolist() for v in self.model.embed(texts, batch_size=64)]


class FakeEmbedder:
    """Deterministic stand-in for tests: same text, same unit vector."""

    def embed(self, texts: list[str]) -> list[list[float]]:
        out = []
        for t in texts:
            seed = hashlib.sha256(t.encode()).digest()
            raw = [(seed[i % 32] - 128) / 128 for i in range(DIMS)]
            norm = math.sqrt(sum(x * x for x in raw)) or 1.0
            out.append([x / norm for x in raw])
        return out


def job_text(title: str, company: str, description: str) -> str:
    """What gets embedded for a job: the parts that say what the work is."""
    return f"{title}\n{company}\n{description[:2000]}"


def to_pgvector(vec: list[float]) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in vec) + "]"
