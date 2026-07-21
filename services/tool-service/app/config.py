import os
from pathlib import Path

from dotenv import load_dotenv

SERVICE_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(SERVICE_ROOT / ".env")


class Settings:
    def __init__(self) -> None:
        self.port = int(os.environ.get("PORT", "5001"))
        self.artifacts_root = Path(
            os.environ.get(
                "ARTIFACTS_ROOT",
                str(SERVICE_ROOT.parent / "artifacts-server" / "artifacts"),
            )
        ).resolve()

        # Used only by the get-schema tool, for read-only introspection at
        # artifact-generation time. The secret key is required because Supabase's
        # schema/OpenAPI endpoint rejects anon/publishable keys.
        self.supabase_url = os.environ.get("SUPABASE_URL")
        self.supabase_secret_key = os.environ.get("SUPABASE_SECRET_KEY")


def get_settings() -> Settings:
    return Settings()
