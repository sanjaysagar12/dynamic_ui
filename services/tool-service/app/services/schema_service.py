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
    """Read-only introspection of the real Supabase schema — tables, columns,
    and constraints (primary keys, foreign keys, unique, and check constraints).

    This is the only place in the whole system that holds the Supabase secret
    key. It exists purely so the AI agent can look up real table/column names
    and constraints before generating code — it is never used for runtime
    artifact data access, which stays anon-key-only via supabase-service.
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
        constraints_by_table = self._fetch_constraints()

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
            tables.append(
                TableSchema(table=table, columns=columns, constraints=constraints_by_table.get(table, []))
            )

        return GetSchemaResponse(tables=tables)

    def _fetch_constraints(self) -> dict[str, list[str]]:
        """Constraints (primary keys, foreign keys, unique, and check) never
        appear in PostgREST's schema/OpenAPI document — only column
        name/type/nullable do. This calls a small SECURITY DEFINER RPC (see
        services/supabase-service/sql/003_create_table_constraints_rpc.sql),
        which is a thin wrapper around:

            SELECT conname AS constraint_name, contype AS constraint_type,
                   pg_get_constraintdef(c.oid) AS definition
            FROM pg_constraint c
            JOIN pg_class t ON c.conrelid = t.oid
            WHERE t.relname = '<table name>';

        run across every table in one call instead of one table at a time. If
        that migration hasn't been run yet, this degrades to "no constraints
        known" rather than failing the whole schema lookup.
        """
        try:
            response = httpx.post(
                f"{self._base_url}/rest/v1/rpc/get_table_constraints",
                headers={
                    "apikey": self._secret_key,
                    "Authorization": f"Bearer {self._secret_key}",
                },
                timeout=15.0,
            )
        except httpx.HTTPError:
            return {}

        if response.is_error:
            return {}

        by_table: dict[str, list[str]] = {}
        for entry in response.json() or []:
            by_table.setdefault(entry["table_name"], []).append(
                f"{entry['constraint_name']}: {entry['definition']}"
            )
        return by_table
