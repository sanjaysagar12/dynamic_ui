from fastapi import APIRouter, HTTPException

from app.config import get_settings
from app.schemas import GetSchemaResponse, ListArtifactsResponse, ReadArtifactResponse, WriteArtifactRequest, WriteArtifactResponse
from app.services.artifact_catalog import ArtifactCatalogService
from app.services.artifact_writer import ArtifactWriterService, InvalidArtifactError
from app.services.schema_service import SchemaNotConfiguredError, SchemaRequestError, SchemaService

router = APIRouter(prefix="/tools", tags=["tools"])


@router.post("/write-artifact", response_model=WriteArtifactResponse)
def write_artifact(request: WriteArtifactRequest) -> WriteArtifactResponse:
    writer = ArtifactWriterService(get_settings())
    try:
        return writer.write(request)
    except InvalidArtifactError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/read-artifact", response_model=ReadArtifactResponse)
def read_artifact(slug: str) -> ReadArtifactResponse:
    writer = ArtifactWriterService(get_settings())
    try:
        result = writer.read(slug)
    except InvalidArtifactError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=404, detail=f"No artifact at '{slug}'")
    return result


@router.get("/list-artifacts", response_model=ListArtifactsResponse)
def list_artifacts() -> ListArtifactsResponse:
    catalog = ArtifactCatalogService(get_settings())
    return ListArtifactsResponse(artifacts=catalog.list_all())


@router.get("/get-schema", response_model=GetSchemaResponse)
def get_schema() -> GetSchemaResponse:
    service = SchemaService(get_settings())
    try:
        return service.describe()
    except SchemaNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except SchemaRequestError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
