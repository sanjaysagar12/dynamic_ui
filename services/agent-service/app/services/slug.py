import re
from pathlib import Path

_SLUG_STRIP_PATTERN = re.compile(r"[^a-z0-9]+")
_MAX_SLUG_LENGTH = 40


def slugify(text: str) -> str:
    slug = _SLUG_STRIP_PATTERN.sub("-", text.lower()).strip("-")[:_MAX_SLUG_LENGTH].strip("-")
    return slug or "artifact"


def unique_slug(base: str, artifacts_root: Path) -> str:
    if not (artifacts_root / base).exists():
        return base

    suffix = 2
    while (artifacts_root / f"{base}-{suffix}").exists():
        suffix += 1
    return f"{base}-{suffix}"


def title_from_slug(slug: str) -> str:
    return slug.replace("-", " ").replace("/", " / ").title()
