import httpx

from app.config import Settings
from app.schemas import ColumnSchema, GetSchemaResponse, TableSchema


class SchemaNotConfiguredError(Exception):
    pass


class SchemaRequestError(Exception):
    def __init__(self, message: str, status_code: int) -> None:
        super().__init__(message)
        self.status_code = status_code


class SchemaService:
    """Read-only introspection of the real Supabase schema.

    This is the only place in the whole system that holds the Supabase secret
    key. It exists purely so the AI agent can look up real table/column names
    before generating code — it is never used for runtime artifact data
    access, which stays anon-key-only via supabase-service.
    """

    def __init__(self, settings: Settings) -> None:
        self._base_url = settings.supabase_url.rstrip("/") if settings.supabase_url else None
        self._secret_key = settings.supabase_secret_key

    def describe(self) -> GetSchemaResponse:
        if not self._base_url or not self._secret_key:
            raise SchemaNotConfiguredError("SUPABASE_URL / SUPABASE_SECRET_KEY are not configured")

        try:
            response = httpx.get(
                f"{self._base_url}/rest/v1/",
                headers={
                    "apikey": self._secret_key,
                    "Authorization": f"Bearer {self._secret_key}",
                    "Accept": "application/openapi+json",
                },
                timeout=15.0,
            )
        except httpx.HTTPError as exc:
            raise SchemaRequestError(f"Failed to reach Supabase for schema introspection: {exc}", 502) from exc

        if response.is_error:
            raise SchemaRequestError(f"Supabase schema request failed (status {response.status_code})", response.status_code)

        spec = response.json()
        definitions = spec.get("definitions") or spec.get("components", {}).get("schemas") or {}

        tables = []
        for table, definition in definitions.items():
            properties = definition.get("properties") or {}
            required = set(definition.get("required") or [])
            columns = [
                ColumnSchema(
                    name=name,
                    type=prop.get("format") or prop.get("type") or "unknown",
                    nullable=name not in required,
                )
                for name, prop in properties.items()
            ]
            tables.append(TableSchema(table=table, columns=columns))

        return GetSchemaResponse(tables=tables)
