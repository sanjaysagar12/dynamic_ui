from app.config import Settings
from app.schemas import Provider, ProviderInfo, ProvidersResponse
from app.services.providers.base import ArtifactGenerationError, ArtifactLLMClient
from app.services.providers.claude_provider import ClaudeArtifactGenerator
from app.services.providers.gemini_provider import GeminiArtifactGenerator
from app.services.tool_client import ToolServiceClient


def get_llm_client(
    provider: Provider, model_override: str | None, settings: Settings, tool_client: ToolServiceClient
) -> ArtifactLLMClient:
    if provider == "claude":
        return ClaudeArtifactGenerator(model=model_override or settings.anthropic_model, tool_client=tool_client)
    if provider == "gemini":
        return GeminiArtifactGenerator(
            model=model_override or settings.gemini_model,
            api_key=settings.gemini_api_key,
            tool_client=tool_client,
        )
    raise ArtifactGenerationError(f"Unknown provider: {provider}")


def list_providers(settings: Settings) -> ProvidersResponse:
    return ProvidersResponse(
        default=settings.default_provider,  # type: ignore[arg-type]
        providers=[
            ProviderInfo(id="claude", label="Claude", model=settings.anthropic_model),
            ProviderInfo(id="gemini", label="Gemini", model=settings.gemini_model),
        ],
    )
