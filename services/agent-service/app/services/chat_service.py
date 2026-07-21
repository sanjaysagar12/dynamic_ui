from app.config import Settings
from app.schemas import ChatMessage, ChatRequest, ChatResponse
from app.services.artifact_persistence import persist_spec
from app.services.providers.factory import get_llm_client
from app.services.tool_client import ToolServiceClient


class ChatArtifactService:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._tool_client = ToolServiceClient(settings.tool_service_url)

    def chat(self, request: ChatRequest) -> ChatResponse:
        provider = request.provider or self._settings.default_provider
        client = get_llm_client(provider, request.model, self._settings, self._tool_client)

        context_files: dict[str, str] | None = None
        if request.slug:
            existing = self._tool_client.read_artifact(request.slug)
            if existing:
                context_files = existing["files"]

        spec = client.generate(messages=request.messages, context_files=context_files)
        slug = request.slug or spec.slug

        result = persist_spec(self._tool_client, self._settings.artifacts_server_url, slug, request.roles, spec)

        return ChatResponse(
            reply=spec.reply,
            slug=result["slug"],
            title=spec.title,
            roles=request.roles,
            url_path=result["url_path"],
            preview_url=result["preview_url"],
            files_written=result["files_written"],
            provider=provider,
            messages=[*request.messages, ChatMessage(role="assistant", content=spec.reply)],
        )
