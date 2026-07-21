import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DEFAULT_ANTHROPIC_MODEL = "claude-opus-4-8"
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"


class Settings:
    def __init__(self) -> None:
        self.port = int(os.environ.get("PORT", "5002"))
        self.tool_service_url = os.environ.get("TOOL_SERVICE_URL", "http://localhost:5001")
        self.artifacts_server_url = os.environ.get("ARTIFACTS_SERVER_URL", "http://localhost:3000")

        self.default_provider = os.environ.get("LLM_PROVIDER", "gemini")
        self.anthropic_model = os.environ.get("ANTHROPIC_MODEL", DEFAULT_ANTHROPIC_MODEL)
        self.gemini_model = os.environ.get("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)
        self.gemini_api_key = os.environ.get("GEMINI_API_KEY")


def get_settings() -> Settings:
    return Settings()
