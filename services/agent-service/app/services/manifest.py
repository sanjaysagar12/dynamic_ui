import json
from pathlib import Path

MANIFEST_FILE = "manifest.json"


def write_manifest(artifact_dir: Path, roles: list[str], title: str | None) -> None:
    """Writes manifest.json directly — agent-service owns the artifacts_root
    filesystem the same way opencode does, so this no longer needs to go
    through a separate service. opencode never touches this file itself (see
    AGENTS.md); it only writes the content files."""
    manifest_path = artifact_dir / MANIFEST_FILE
    manifest: dict = {"roles": roles}
    resolved_title = title or read_title(artifact_dir)
    if resolved_title:
        manifest["title"] = resolved_title
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def read_title(artifact_dir: Path) -> str | None:
    manifest_path = artifact_dir / MANIFEST_FILE
    if not manifest_path.is_file():
        return None
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    title = manifest.get("title")
    return title if isinstance(title, str) and title else None
