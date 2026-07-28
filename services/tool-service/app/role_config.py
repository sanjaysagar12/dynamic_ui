import json
from pathlib import Path
from typing import Literal

# The single source of truth for valid roles lives in shared-auth's roles.json
# (not here), so adding/renaming a role is a one-file change instead of
# hunting through every service and component that hardcodes the list.
_REPO_ROOT = Path(__file__).resolve().parents[3]
_ROLES_CONFIG_PATH = _REPO_ROOT / "packages" / "shared-auth" / "src" / "lib" / "roles.json"

ROLES: tuple[str, ...] = tuple(json.loads(_ROLES_CONFIG_PATH.read_text())["roles"])
Role = Literal[ROLES]  # type: ignore[valid-type]
