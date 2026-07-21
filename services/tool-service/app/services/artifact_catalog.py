import json
from pathlib import Path, PurePosixPath

from app.config import Settings
from app.schemas import ArtifactCatalogEntry

MANIFEST_FILE = "manifest.json"


class ArtifactCatalogService:
    def __init__(self, settings: Settings) -> None:
        self._artifacts_root = settings.artifacts_root

    def list_all(self) -> list[ArtifactCatalogEntry]:
        entries = self._walk(self._artifacts_root)
        return sorted(entries, key=lambda e: e.slug)

    def _walk(self, directory: Path) -> list[ArtifactCatalogEntry]:
        manifest_path = directory / MANIFEST_FILE

        if manifest_path.is_file():
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                manifest = None

            if manifest is not None:
                slug = PurePosixPath(directory.relative_to(self._artifacts_root).as_posix()).as_posix()
                if slug and slug != ".":
                    return [
                        ArtifactCatalogEntry(
                            slug=slug,
                            title=manifest.get("title") or slug,
                            roles=manifest.get("roles", []),
                        )
                    ]
                return []

        results: list[ArtifactCatalogEntry] = []
        try:
            children = sorted(directory.iterdir())
        except OSError:
            return []

        for child in children:
            if child.is_dir():
                results.extend(self._walk(child))
        return results
