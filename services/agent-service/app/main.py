from fastapi import FastAPI

from app.routers.agent import router as agent_router

app = FastAPI(title="agent-service")
app.include_router(agent_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
