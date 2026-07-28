from typing import Literal

from pydantic import BaseModel, Field

from app.role_config import ROLES, Role

Provider = Literal["claude", "gemini"]


class GenerateArtifactRequest(BaseModel):
    prompt: str = Field(..., min_length=1, description="Natural-language description of the UI to generate")
    slug: str | None = Field(None, description="Optional artifact path override, e.g. 'reports/weekly'")
    roles: list[Role] = Field(default_factory=lambda: list(ROLES))
    provider: Provider | None = Field(None, description="LLM provider to use; defaults to LLM_PROVIDER env var")
    model: str | None = Field(None, description="Override the provider's default model id")


class GenerateArtifactResponse(BaseModel):
    slug: str
    title: str
    reply: str
    roles: list[Role]
    url_path: str
    preview_url: str
    files_written: list[str]
    provider: Provider


class ArtifactSpec(BaseModel):
    """Structured output shape requested from the LLM."""

    reply: str
    slug: str
    title: str
    index_html: str
    css: str
    js: str


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(..., min_length=1)
    slug: str | None = Field(None, description="Existing artifact to update; omit to create a new one")
    roles: list[Role] = Field(default_factory=lambda: list(ROLES))
    provider: Provider | None = Field(None, description="LLM provider to use; defaults to LLM_PROVIDER env var")
    model: str | None = Field(None, description="Override the provider's default model id")


class ChatResponse(BaseModel):
    reply: str
    slug: str
    title: str
    roles: list[Role]
    url_path: str
    preview_url: str
    files_written: list[str]
    provider: Provider
    messages: list[ChatMessage]


class ProviderInfo(BaseModel):
    id: Provider
    label: str
    model: str


class ProvidersResponse(BaseModel):
    default: Provider
    providers: list[ProviderInfo]
