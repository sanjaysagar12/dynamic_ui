from fastapi import APIRouter, HTTPException, Response

from app.config import get_settings
from app.schemas import CreateSkillRequest, ListSkillsResponse, Skill, UpdateSkillRequest
from app.services.skill_service import (
    InvalidSkillNameError,
    SkillAlreadyExistsError,
    SkillNotFoundError,
    create_skill,
    delete_skill,
    list_skills,
    read_skill,
    update_skill,
)

router = APIRouter(prefix="/agent/skills", tags=["skills"])


@router.get("", response_model=ListSkillsResponse)
def get_skills() -> ListSkillsResponse:
    settings = get_settings()
    return ListSkillsResponse(skills=list_skills(settings.artifacts_root))


@router.get("/{name}", response_model=Skill)
def get_skill(name: str) -> Skill:
    settings = get_settings()
    try:
        skill = read_skill(settings.artifacts_root, name)
    except InvalidSkillNameError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if skill is None:
        raise HTTPException(status_code=404, detail=f"Skill '{name}' not found")
    return Skill(**skill)


@router.post("", response_model=Skill, status_code=201)
def post_skill(request: CreateSkillRequest) -> Skill:
    settings = get_settings()
    try:
        skill = create_skill(settings.artifacts_root, request.name, request.description, request.content)
    except InvalidSkillNameError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except SkillAlreadyExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return Skill(**skill)


@router.put("/{name}", response_model=Skill)
def put_skill(name: str, request: UpdateSkillRequest) -> Skill:
    settings = get_settings()
    try:
        skill = update_skill(settings.artifacts_root, name, request.description, request.content)
    except InvalidSkillNameError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except SkillNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Skill(**skill)


@router.delete("/{name}", status_code=204, response_class=Response)
def remove_skill(name: str) -> Response:
    settings = get_settings()
    try:
        delete_skill(settings.artifacts_root, name)
    except InvalidSkillNameError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except SkillNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(status_code=204)
