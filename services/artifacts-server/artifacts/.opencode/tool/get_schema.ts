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

function formatSchema(tables: TableSchema[]): string {
  if (tables.length === 0) return "No tables are currently exposed in the database."

  const lines: string[] = []
  for (const table of tables) {
    const columns = table.columns
      .map((col) => `${col.name} (${col.type}${col.nullable ? ", nullable" : ""})`)
      .join(", ")
    lines.push(`- ${table.table}: ${columns}`)
    for (const constraint of table.constraints) {
      lines.push(`    CONSTRAINT — ${constraint}`)
    }
  }
  return (
    "Available tables and columns (CONSTRAINT lines are PRIMARY KEY / FOREIGN KEY / UNIQUE / CHECK " +
    "constraints — any value you write for that table must satisfy every listed constraint):\n" +
    lines.join("\n")
  )
}

export default tool({
  description:
    "Returns the real tables and columns available in the shared Supabase database (name, type, " +
    "nullability), plus every constraint on each table — primary keys, foreign keys, unique " +
    "constraints, and CHECK constraints (e.g. a column restricted to a fixed set of allowed values) — " +
    "that artifacts can read/write through the parent app's postMessage data bridge. " +
    "Call this BEFORE writing any code that persists or loads data, so you use the actual table/column " +
    "names and only ever write values that satisfy each table's constraints, instead of guessing either. " +
    "Skip it for artifacts that only need local, in-memory UI state.",
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
    const constraintsByTable = await fetchConstraints(baseUrl, secretKey)

    const tables: TableSchema[] = Object.entries(definitions).map(([table, definition]) => {
      const properties = definition.properties ?? {}
      const required = new Set<string>(definition.required ?? [])
      const columns: ColumnSchema[] = Object.entries(properties).map(([name, prop]: [string, any]) => ({
        name,
        type: prop.format ?? prop.type ?? "unknown",
        nullable: !required.has(name),
      }))
      return { table, columns, constraints: constraintsByTable[table] ?? [] }
    })

    return formatSchema(tables)
  },
})
