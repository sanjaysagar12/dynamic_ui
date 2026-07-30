from pathlib import PurePosixPath

from app.config import PROVIDER_MODEL_PREFIX, Settings
from app.schemas import ChatMessage, ChatRequest, ChatResponse
from app.services.manifest import read_title, write_manifest
from app.services.opencode_runner import OpenCodeRunner
from app.services.slug import slugify, title_from_slug, unique_slug


def render_transcript(messages: list[ChatMessage]) -> str:
    return "\n".join(f"{'User' if m.role == 'user' else 'Assistant'}: {m.content}" for m in messages)


class ChatArtifactService:
    # Best-effort opencode session id per artifact slug, so multi-turn edits
    # reuse context instead of opencode re-discovering the directory from
    # scratch each time. In-memory only — lost on restart, which is fine
    # since the full transcript is always reconstructed into the prompt
    # regardless (see render_transcript), so correctness never depends on it.
    _sessions: dict[str, str] = {}

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._opencode = OpenCodeRunner(settings.opencode_bin, settings.opencode_timeout)

    def chat(self, request: ChatRequest) -> ChatResponse:
        provider = request.provider or self._settings.default_provider
        model_name = request.model or (
            self._settings.anthropic_model if provider == "claude" else self._settings.gemini_model
        )
        model = f"{PROVIDER_MODEL_PREFIX[provider]}/{model_name}"

        is_new = request.slug is None
        slug = request.slug or unique_slug(slugify(request.messages[0].content), self._settings.artifacts_root)
        artifact_dir = self._settings.artifacts_root / slug
        artifact_dir.mkdir(parents=True, exist_ok=True)

        session_id = self._sessions.get(slug)
        # When continuing a live opencode session, it already has the prior
        # turns in its own history — resending the full reconstructed
        # transcript on top of that duplicates/conflicts with what it
        # remembers (confirmed: it makes the model re-validate the original
        # request instead of applying the newest one). Only reconstruct full
        # history as a fallback when there's no session to continue (first
        # turn, or the session was lost e.g. after an agent-service restart).
        prompt = request.messages[-1].content if session_id else render_transcript(request.messages)
        result = self._opencode.run(
            directory=artifact_dir,
            prompt=prompt,
            model=model,
            session_id=session_id,
        )
        if result.session_id:
            self._sessions[slug] = result.session_id

        # opencode only ever writes the content files (index.html/assets/*) —
        # manifest.json (roles/title) is this service's own responsibility
        # now that there's no separate tool-service to delegate it to. Only
        # set a fresh title for a brand-new artifact; on an edit, keep
        # whatever title is already there instead of clobbering it every turn.
        title = title_from_slug(slug) if is_new else (read_title(artifact_dir) or title_from_slug(slug))
        write_manifest(artifact_dir, roles=request.roles, title=title)

        files_written = sorted(
            path.relative_to(artifact_dir).as_posix()
            for path in artifact_dir.rglob("*")
            if path.is_file() and path.name != "manifest.json"
        )
        url_path = "/" + PurePosixPath(slug).as_posix().strip("/") + "/"

        return ChatResponse(
            reply=result.reply,
            slug=slug,
            title=title,
            roles=request.roles,
            url_path=url_path,
            preview_url=f"{self._settings.artifacts_server_url.rstrip('/')}{url_path}",
            files_written=files_written,
            provider=provider,
            messages=[*request.messages, ChatMessage(role="assistant", content=result.reply)],
        )
