from fastapi import FastAPI

from app.routers.tools import router as tools_router

app = FastAPI(title="tool-service")
app.include_router(tools_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
