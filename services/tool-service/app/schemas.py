from typing import Literal

from pydantic import BaseModel, Field

Role = Literal["admin", "manager"]


class WriteArtifactRequest(BaseModel):
    slug: str = Field(..., description="Artifact path, e.g. 'dashboard' or 'admin/reports'")
    roles: list[Role] = Field(..., min_length=1, description="Roles allowed to view this artifact")
    title: str | None = Field(None, description="Human-readable title shown when browsing artifacts")
    files: dict[str, str] = Field(
        ..., min_length=1, description="Relative file path -> file contents. Must include 'index.html'."
    )


class WriteArtifactResponse(BaseModel):
    slug: str
    path: str
    url_path: str
    files_written: list[str]


class ReadArtifactResponse(BaseModel):
    slug: str
    url_path: str
    roles: list[Role]
    title: str | None
    files: dict[str, str]


class ArtifactCatalogEntry(BaseModel):
    slug: str
    title: str
    roles: list[Role]


class ListArtifactsResponse(BaseModel):
    artifacts: list[ArtifactCatalogEntry]
