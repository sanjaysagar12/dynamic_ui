import json
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from app.services.providers.base import ArtifactGenerationError


@dataclass
class OpenCodeResult:
    reply: str
    session_id: str | None


class OpenCodeRunner:
    """Drives opencode as a subprocess to generate/edit an artifact's files
    directly on disk. opencode itself owns the actual file-editing tools and
    the get_schema/AGENTS.md conventions already set up under
    services/artifacts-server/artifacts/ — this class only has to invoke it
    and pull the reply text back out of its event stream.
    """

    def __init__(self, opencode_bin: str, timeout: float) -> None:
        # Resolved once via PATH (incl. extension, e.g. opencode.CMD on
        # Windows) since subprocess can't exec a bare npm .cmd shim by name.
        resolved = shutil.which(opencode_bin)
        if not resolved:
            raise ArtifactGenerationError(f"opencode binary '{opencode_bin}' was not found on PATH")
        self._bin = resolved
        self._timeout = timeout

    def run(self, directory: Path, prompt: str, model: str, session_id: str | None) -> OpenCodeResult:
        args = [self._bin, "run", "--dir", str(directory), "--format", "json", "--model", model]
        if session_id:
            args += ["--session", session_id]
        args.append(prompt)

        try:
            result = subprocess.run(
                args,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=self._timeout,
            )
        except subprocess.TimeoutExpired as exc:
            raise ArtifactGenerationError(f"opencode timed out after {self._timeout}s") from exc

        if result.returncode != 0:
            raise ArtifactGenerationError(
                f"opencode exited with status {result.returncode}: {result.stderr.strip() or result.stdout.strip()}"
            )

        reply, resolved_session_id = self._parse_events(result.stdout)
        if reply is None:
            raise ArtifactGenerationError("opencode produced no text reply")

        return OpenCodeResult(reply=reply, session_id=resolved_session_id or session_id)

    def _parse_events(self, stdout: str) -> tuple[str | None, str | None]:
        reply: str | None = None
        session_id: str | None = None

        for line in stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue

            session_id = event.get("sessionID") or session_id

            part = event.get("part") or {}
            if event.get("type") == "text" and part.get("type") == "text":
                text = part.get("text")
                if isinstance(text, str) and text:
                    reply = text

        return reply, session_id
