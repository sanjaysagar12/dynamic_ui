import json
from pathlib import Path, PurePosixPath

from app.config import Settings
from app.schemas import ReadArtifactResponse, WriteArtifactRequest, WriteArtifactResponse

INDEX_FILE = "index.html"
MANIFEST_FILE = "manifest.json"


class InvalidArtifactError(Exception):
    pass


class ArtifactWriterService:
    def __init__(self, settings: Settings) -> None:
        self._artifacts_root = settings.artifacts_root

    def write(self, request: WriteArtifactRequest) -> WriteArtifactResponse:
        if INDEX_FILE not in request.files:
            raise InvalidArtifactError(f"files must include '{INDEX_FILE}'")

        artifact_dir = self._resolve_within_root(request.slug)
        artifact_dir.mkdir(parents=True, exist_ok=True)

        manifest_path = artifact_dir / MANIFEST_FILE
        title = request.title or self._existing_title(manifest_path)

        manifest: dict = {"roles": request.roles}
        if title:
            manifest["title"] = title
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

        written: list[str] = []
        for relative_path, content in request.files.items():
            file_path = self._resolve_within_root(request.slug, relative_path)
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.write_text(content, encoding="utf-8")
            written.append(relative_path)

        url_path = "/" + PurePosixPath(request.slug).as_posix().strip("/") + "/"

        return WriteArtifactResponse(
            slug=request.slug,
            path=str(artifact_dir),
            url_path=url_path,
            files_written=written,
        )

    def read(self, slug: str) -> ReadArtifactResponse | None:
        artifact_dir = self._resolve_within_root(slug)
        manifest_path = artifact_dir / MANIFEST_FILE

        if not manifest_path.is_file():
            return None

        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

        files: dict[str, str] = {}
        for file_path in artifact_dir.rglob("*"):
            if not file_path.is_file() or file_path == manifest_path:
                continue
            relative = file_path.relative_to(artifact_dir).as_posix()
            files[relative] = file_path.read_text(encoding="utf-8")

        url_path = "/" + PurePosixPath(slug).as_posix().strip("/") + "/"

        return ReadArtifactResponse(
            slug=slug,
            url_path=url_path,
            roles=manifest.get("roles", []),
            title=manifest.get("title"),
            files=files,
        )

    def _existing_title(self, manifest_path: Path) -> str | None:
        if not manifest_path.is_file():
            return None
        try:
            existing = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None
        title = existing.get("title")
        return title if isinstance(title, str) and title else None

    def _resolve_within_root(self, slug: str, relative_path: str | None = None) -> Path:
        segments = [s for s in PurePosixPath(slug).parts if s not in ("", ".")]
        if relative_path is not None:
            segments += [s for s in PurePosixPath(relative_path).parts if s not in ("", ".")]

        if any(segment == ".." for segment in segments):
            raise InvalidArtifactError("path traversal is not allowed")

        candidate = self._artifacts_root.joinpath(*segments).resolve()
        if candidate != self._artifacts_root and self._artifacts_root not in candidate.parents:
            raise InvalidArtifactError("resolved path escapes the artifacts root")

        return candidate
