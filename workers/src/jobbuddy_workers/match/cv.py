"""From a confirmed JSON Resume to the text that gets embedded and the user's skill list."""

from __future__ import annotations

from typing import Any


def cv_text(resume: dict[str, Any]) -> str:
    """Headline, summary, recent roles and skills: what the person does, not contact details."""
    basics = resume.get("basics") or {}
    parts: list[str] = [basics.get("label") or "", basics.get("summary") or ""]
    for job in (resume.get("work") or [])[:5]:
        parts.append(f"{job.get('position', '')} at {job.get('name', '')}")
        parts += (job.get("highlights") or [])[:6]
    for group in resume.get("skills") or []:
        parts.append(", ".join(group.get("keywords") or [group.get("name", "")]))
    for project in (resume.get("projects") or [])[:3]:
        parts.append(f"{project.get('name', '')}: {project.get('description', '')}")
        parts.append(", ".join(project.get("keywords") or []))
    return "\n".join(p for p in parts if p and p.strip())[:4000]


def cv_skills(resume: dict[str, Any]) -> list[str]:
    """Skills in the order the user listed them, without duplicates."""
    seen: dict[str, str] = {}
    for group in resume.get("skills") or []:
        for kw in group.get("keywords") or []:
            if isinstance(kw, str) and kw.strip():
                seen.setdefault(kw.strip().lower(), kw.strip())
    for project in resume.get("projects") or []:
        for kw in project.get("keywords") or []:
            if isinstance(kw, str) and kw.strip():
                seen.setdefault(kw.strip().lower(), kw.strip())
    return list(seen.values())


def cv_roles(resume: dict[str, Any]) -> set[str]:
    """Kinds of role the person has held (backend, platform, data...), from their titles."""
    from .tech import role_families

    titles = [(resume.get("basics") or {}).get("label") or ""]
    titles += [str(job.get("position") or "") for job in (resume.get("work") or [])[:6]]
    out: set[str] = set()
    for title in titles:
        out |= role_families(title)
    return out
