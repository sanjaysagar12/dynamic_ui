import { tool } from "@opencode-ai/plugin"

// Ported from services/tool-service/app/services/schema_service.py and
// services/agent-service/app/services/providers/base.py's
// format_schema_for_tool_result — this is the opencode-native equivalent of
// that get_schema tool, talking to Supabase directly instead of through
// tool-service.

interface ColumnSchema {
  name: string
  type: string
  nullable: boolean
  enumValues?: string[]
}

interface TableSchema {
  table: string
  columns: ColumnSchema[]
  constraints: string[]
}

async function fetchConstraints(baseUrl: string, secretKey: string): Promise<Record<string, string[]>> {
  // Constraints (primary keys, foreign keys, unique, and check) never appear
  // in PostgREST's schema/OpenAPI document — only column name/type/nullable
  // do. This calls the SECURITY DEFINER RPC from
  // services/supabase-service/sql/003_create_table_constraints_rpc.sql. If
  // that migration hasn't been run yet, this degrades to "no constraints
  // known" rather than failing the whole schema lookup.
  try {
    const response = await fetch(`${baseUrl}/rest/v1/rpc/get_table_constraints`, {
      method: "POST",
      headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}` },
    })
    if (!response.ok) return {}

    const rows = (await response.json()) as { table_name: string; constraint_name: string; definition: string }[]
    const byTable: Record<string, string[]> = {}
    for (const row of rows) {
      const list = byTable[row.table_name] ?? (byTable[row.table_name] = [])
      list.push(`${row.constraint_name}: ${row.definition}`)
    }
    return byTable
  } catch {
    return {}
  }
}

async function fetchEnumValues(baseUrl: string, secretKey: string): Promise<Record<string, string[]>> {
  // A column's enum TYPE name (e.g. `public."UserRole"`) is the only thing
  // PostgREST's OpenAPI document reports for it — never the enum's actual
  // allowed values. This calls the SECURITY DEFINER RPC from
  // services/supabase-service/sql/004_create_enum_values_rpc.sql. If that
  // migration hasn't been run yet, this degrades to "no enum values known"
  // rather than failing the whole schema lookup.
  try {
    const response = await fetch(`${baseUrl}/rest/v1/rpc/get_enum_values`, {
      method: "POST",
      headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}` },
    })
    if (!response.ok) return {}

    const rows = (await response.json()) as { enum_name: string; enum_value: string }[]
    const byEnum: Record<string, string[]> = {}
    for (const row of rows) {
      const list = byEnum[row.enum_name] ?? (byEnum[row.enum_name] = [])
      list.push(row.enum_value)
    }
    return byEnum
  } catch {
    return {}
  }
}

// PostgREST reports an enum column's type as e.g. `public."UserRole"` (schema
// prefix, optionally quoted) — strip both to match against pg_type.typname.
function bareTypeName(type: string): string {
  return type.replace(/^[^.]+\./, "").replace(/^"|"$/g, "")
}

function formatSchema(tables: TableSchema[]): string {
  if (tables.length === 0) return "No tables are currently exposed in the database."

  const lines: string[] = []
  for (const table of tables) {
    const columns = table.columns
      .map((col) => {
        const enumSuffix = col.enumValues?.length ? `, allowed: ${col.enumValues.join(", ")}` : ""
        return `${col.name} (${col.type}${col.nullable ? ", nullable" : ""}${enumSuffix})`
      })
      .join(", ")
    lines.push(`- ${table.table}: ${columns}`)
    for (const constraint of table.constraints) {
      lines.push(`    CONSTRAINT — ${constraint}`)
    }
  }
  return (
    "Available tables and columns (CONSTRAINT lines are PRIMARY KEY / FOREIGN KEY / UNIQUE / CHECK " +
    "constraints, plus enum-typed columns' allowed values — any value you write for that table must " +
    "satisfy every listed constraint):\n" +
    lines.join("\n")
  )
}

export default tool({
  description:
    "Returns the real tables and columns available in the shared Supabase database (name, type, " +
    "nullability), plus every constraint on each table — primary keys, foreign keys, unique " +
    "constraints, and CHECK constraints (e.g. a column restricted to a fixed set of allowed values) — " +
    "and, for any column typed as a Postgres enum, the exact list of values that enum allows — " +
    "for data that artifacts read/write through the parent app's postMessage data bridge. " +
    "Call this BEFORE writing any code that persists or loads data, so you use the actual table/column " +
    "names and only ever write values that satisfy each table's constraints and enum options, instead of " +
    "guessing either. Skip it for artifacts that only need local, in-memory UI state.",
  args: {},
  async execute() {
    const baseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, "")
    const secretKey = process.env.SUPABASE_SECRET_KEY
    if (!baseUrl || !secretKey) {
      return "Schema lookup failed: SUPABASE_URL / SUPABASE_SECRET_KEY are not configured. Proceed without relying on exact table/column names."
    }

    let response: Response
    try {
      response = await fetch(`${baseUrl}/rest/v1/`, {
        headers: {
          apikey: secretKey,
          Authorization: `Bearer ${secretKey}`,
          Accept: "application/openapi+json",
        },
      })
    } catch (err) {
      return `Schema lookup failed: could not reach Supabase (${err instanceof Error ? err.message : String(err)}). Proceed without relying on exact table/column names.`
    }

    if (!response.ok) {
      return `Schema lookup failed: Supabase schema request failed (status ${response.status}). Proceed without relying on exact table/column names.`
    }

    const spec = (await response.json()) as {
      definitions?: Record<string, any>
      components?: { schemas?: Record<string, any> }
    }
    const definitions = spec.definitions ?? spec.components?.schemas ?? {}
    const [constraintsByTable, enumValuesByType] = await Promise.all([
      fetchConstraints(baseUrl, secretKey),
      fetchEnumValues(baseUrl, secretKey),
    ])

    const tables: TableSchema[] = Object.entries(definitions).map(([table, definition]) => {
      const properties = definition.properties ?? {}
      const required = new Set<string>(definition.required ?? [])
      const columns: ColumnSchema[] = Object.entries(properties).map(([name, prop]: [string, any]) => {
        const type = prop.format ?? prop.type ?? "unknown"
        // PostgREST's OpenAPI document already includes an enum-typed
        // column's allowed values inline (`prop.enum`) — no RPC needed for
        // this, and it's more reliable than 004_create_enum_values_rpc.sql
        // since it works even if that migration was never applied. Only
        // fall back to the RPC-sourced lookup if PostgREST didn't include it.
        const enumValues: string[] | undefined = Array.isArray(prop.enum)
          ? prop.enum
          : enumValuesByType[bareTypeName(type)]
        return { name, type, nullable: !required.has(name), enumValues }
      })

      return { table, columns, constraints: constraintsByTable[table] ?? [] }
    })

    return formatSchema(tables)
  },
})
