from app.config import Settings
from app.schemas import ChatMessage, ChatRequest, GenerateArtifactRequest, GenerateArtifactResponse
from app.services.chat_service import ChatArtifactService


class ArtifactGeneratorService:
    """Thin wrapper around ChatArtifactService for the one-shot /generate-artifact
    endpoint, so there's a single place driving opencode rather than a second
    copy of that logic."""

    def __init__(self, settings: Settings) -> None:
        self._chat_service = ChatArtifactService(settings)

    def generate(self, request: GenerateArtifactRequest) -> GenerateArtifactResponse:
        chat_request = ChatRequest(
            messages=[ChatMessage(role="user", content=request.prompt)],
            slug=request.slug,
            roles=request.roles,
            provider=request.provider,
            model=request.model,
        )
        result = self._chat_service.chat(chat_request)

        return GenerateArtifactResponse(
            slug=result.slug,
            title=result.title,
            reply=result.reply,
            roles=result.roles,
            url_path=result.url_path,
            preview_url=result.preview_url,
            files_written=result.files_written,
            provider=result.provider,
        )
