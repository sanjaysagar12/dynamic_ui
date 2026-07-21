import httpx


class ToolServiceError(Exception):
    def __init__(self, message: str, status_code: int) -> None:
        super().__init__(message)
        self.status_code = status_code


class ToolServiceClient:
    def __init__(self, base_url: str) -> None:
        self._base_url = base_url.rstrip("/")

    def write_artifact(self, slug: str, roles: list[str], files: dict[str, str], title: str | None = None) -> dict:
        response = httpx.post(
            f"{self._base_url}/tools/write-artifact",
            json={"slug": slug, "roles": roles, "title": title, "files": files},
            timeout=30.0,
        )
        if response.is_error:
            detail = response.json().get("detail", response.text) if response.text else response.text
            raise ToolServiceError(str(detail), response.status_code)
        return response.json()

    def read_artifact(self, slug: str) -> dict | None:
        response = httpx.get(
            f"{self._base_url}/tools/read-artifact",
            params={"slug": slug},
            timeout=30.0,
        )
        if response.status_code == 404:
            return None
        if response.is_error:
            detail = response.json().get("detail", response.text) if response.text else response.text
            raise ToolServiceError(str(detail), response.status_code)
        return response.json()

    def get_schema(self) -> list[dict]:
        response = httpx.get(f"{self._base_url}/tools/get-schema", timeout=15.0)
        if response.is_error:
            detail = response.json().get("detail", response.text) if response.text else response.text
            raise ToolServiceError(str(detail), response.status_code)
        return response.json()["tables"]
