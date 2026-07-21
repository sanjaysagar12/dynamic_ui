import os
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parent.parent


class Settings:
    def __init__(self) -> None:
        self.port = int(os.environ.get("PORT", "5001"))
        self.artifacts_root = Path(
            os.environ.get(
                "ARTIFACTS_ROOT",
                str(SERVICE_ROOT.parent / "artifacts-server" / "artifacts"),
            )
        ).resolve()


def get_settings() -> Settings:
    return Settings()
