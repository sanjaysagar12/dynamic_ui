import { tool } from "@opencode-ai/plugin"

// Replaces get_schema.ts. Artifacts no longer talk to a database directly —
// all data access goes through a fixed catalog of named backend tools,
// served by tool-service (services/tool-service) and callable at runtime
// only through the postMessage data bridge described in AGENTS.md. This
// tool is opencode's read-only view of that same catalog at
// generation/edit time, so code gets written against tools that actually
// exist instead of invented table/endpoint names.

interface ToolCatalogEntry {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  mutates: boolean
  destructive: boolean
  requiredRoles: string[]
}

function formatTools(tools: ToolCatalogEntry[]): string {
  if (tools.length === 0) return "No tools are currently available in the catalog."

  const lines: string[] = []
  for (const t of tools) {
    const flags = [t.mutates ? "mutates" : null, t.destructive ? "destructive" : null].filter(Boolean)
    const flagSuffix = flags.length ? ` (${flags.join(", ")})` : ""
    const roles = t.requiredRoles.length > 0 ? t.requiredRoles.join(", ") : "none"
    lines.push(`- ${t.name}${flagSuffix}: ${t.description}`)
    lines.push(`    required roles: ${roles}`)
    lines.push(`    args (JSON Schema): ${JSON.stringify(t.inputSchema)}`)
  }
  return (
    "Available tools (call these ONLY through the postMessage data bridge described in AGENTS.md " +
    "— never call tool-service directly). '(mutates)' tools need an explicit user confirmation " +
    "step before calling with confirmed: true; '(destructive)' tools additionally need that " +
    "confirmation to restate exactly what will change or be deleted:\n" +
    lines.join("\n")
  )
}

export default tool({
  description:
    "Returns the current catalog of backend tools available for artifacts to read/write data " +
    "through the postMessage data bridge — each tool's name, whether it mutates or destructively " +
    "mutates data, its description, which roles (if any) are required to call it, and its exact " +
    "argument shape as JSON Schema. Call this BEFORE writing any code that persists or loads data, " +
    "every session — there is no hardcoded list to fall back on and the catalog can change. Skip " +
    "it for artifacts that only need local, in-memory UI state.",
  args: {},
  async execute() {
    const baseUrl = (process.env.TOOL_SERVICE_URL || "http://localhost:5104").replace(/\/+$/, "")

    let response: Response
    try {
      response = await fetch(`${baseUrl}/tools`)
    } catch (err) {
      return `Tool catalog lookup failed: could not reach tool-service (${err instanceof Error ? err.message : String(err)}). Do not invent tool names — tell the user data access isn't available right now.`
    }

    if (!response.ok) {
      return `Tool catalog lookup failed: tool-service returned status ${response.status}. Do not invent tool names — tell the user data access isn't available right now.`
    }

    const body = (await response.json()) as { tools?: ToolCatalogEntry[] }
    return formatTools(body.tools ?? [])
  },
})
