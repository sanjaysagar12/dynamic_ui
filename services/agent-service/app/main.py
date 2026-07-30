from fastapi import FastAPI

from app.routers.agent import router as agent_router
from app.routers.skills import router as skills_router

app = FastAPI(title="agent-service")
app.include_router(agent_router)
app.include_router(skills_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
