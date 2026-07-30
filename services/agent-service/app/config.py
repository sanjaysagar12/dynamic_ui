import os
from pathlib import Path

from dotenv import load_dotenv

SERVICE_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(SERVICE_ROOT / ".env")

DEFAULT_ANTHROPIC_MODEL = "claude-opus-4-8"
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"

# Maps the public Provider literal to the prefix opencode expects in its
# `--model <provider>/<model>` flag (verified against `opencode models`).
PROVIDER_MODEL_PREFIX = {"claude": "anthropic", "gemini": "google"}


class Settings:
    def __init__(self) -> None:
        self.port = int(os.environ.get("PORT", "5002"))
        self.artifacts_server_url = os.environ.get("ARTIFACTS_SERVER_URL", "http://localhost:3000")

        self.default_provider = os.environ.get("LLM_PROVIDER", "gemini")
        self.anthropic_model = os.environ.get("ANTHROPIC_MODEL", DEFAULT_ANTHROPIC_MODEL)
        self.gemini_model = os.environ.get("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)
        # ANTHROPIC_API_KEY / GEMINI_API_KEY are not read here — opencode (a
        # subprocess of this service) resolves its own provider credentials
        # directly from the inherited environment / its own auth store.

        # opencode is what actually generates/edits artifact files now; see
        # services/agent-service/app/services/opencode_runner.py.
        self.artifacts_root = Path(
            os.environ.get("ARTIFACTS_ROOT", str(SERVICE_ROOT.parent / "artifacts-server" / "artifacts"))
        ).resolve()
        self.opencode_bin = os.environ.get("OPENCODE_BIN", "opencode")
        # A complex multi-screen artifact (role-based dashboards, several
        # tables/forms) can legitimately take 3-5+ minutes. This used to
        # default to 300s, which raced against Node's own ~300s default fetch
        # timeout on the Next.js side (see agent-service-client.ts) — on a
        # long request either clock could fire first, causing an intermittent
        # "Unexpected error contacting agent service" even though opencode
        # was about to finish successfully. Both sides now have real headroom.
        self.opencode_timeout = float(os.environ.get("OPENCODE_TIMEOUT_SECONDS", "900"))


def get_settings() -> Settings:
    return Settings()
