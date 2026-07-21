from fastapi import APIRouter, HTTPException

from app.config import get_settings
from app.schemas import (
    ChatRequest,
    ChatResponse,
    GenerateArtifactRequest,
    GenerateArtifactResponse,
    ProvidersResponse,
)
from app.services.artifact_generator import ArtifactGeneratorService
from app.services.chat_service import ChatArtifactService
from app.services.providers.base import ArtifactGenerationError
from app.services.providers.factory import list_providers
from app.services.tool_client import ToolServiceError

router = APIRouter(prefix="/agent", tags=["agent"])


@router.get("/providers", response_model=ProvidersResponse)
def get_providers() -> ProvidersResponse:
    return list_providers(get_settings())


@router.post("/generate-artifact", response_model=GenerateArtifactResponse)
def generate_artifact(request: GenerateArtifactRequest) -> GenerateArtifactResponse:
    generator = ArtifactGeneratorService(get_settings())
    try:
        return generator.generate(request)
    except ArtifactGenerationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ToolServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    chat_service = ChatArtifactService(get_settings())
    try:
        return chat_service.chat(request)
    except ArtifactGenerationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ToolServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
