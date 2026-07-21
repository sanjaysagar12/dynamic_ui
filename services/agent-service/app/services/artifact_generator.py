from app.config import Settings
from app.schemas import ChatMessage, GenerateArtifactRequest, GenerateArtifactResponse
from app.services.artifact_persistence import persist_spec
from app.services.providers.factory import get_llm_client
from app.services.tool_client import ToolServiceClient


class ArtifactGeneratorService:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._tool_client = ToolServiceClient(settings.tool_service_url)

    def generate(self, request: GenerateArtifactRequest) -> GenerateArtifactResponse:
        provider = request.provider or self._settings.default_provider
        client = get_llm_client(provider, request.model, self._settings)

        spec = client.generate(
            messages=[ChatMessage(role="user", content=request.prompt)],
            context_files=None,
        )
        slug = request.slug or spec.slug

        result = persist_spec(self._tool_client, self._settings.artifacts_server_url, slug, request.roles, spec)

        return GenerateArtifactResponse(
            slug=result["slug"],
            title=spec.title,
            reply=spec.reply,
            roles=request.roles,
            url_path=result["url_path"],
            preview_url=result["preview_url"],
            files_written=result["files_written"],
            provider=provider,
        )
