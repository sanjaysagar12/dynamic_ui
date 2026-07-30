from app.config import Settings
from app.schemas import ProviderInfo, ProvidersResponse


def list_providers(settings: Settings) -> ProvidersResponse:
    return ProvidersResponse(
        default=settings.default_provider,  # type: ignore[arg-type]
        providers=[
            ProviderInfo(id="claude", label="Claude", model=settings.anthropic_model),
            ProviderInfo(id="gemini", label="Gemini", model=settings.gemini_model),
        ],
    )
