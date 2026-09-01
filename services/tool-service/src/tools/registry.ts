import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ToolDefinition } from './types.js';

// Cast to a loose signature: the real overloads of zodToJsonSchema recurse
// deeply enough through a ZodType<any> that tsc hits TS2589 ("type
// instantiation is excessively deep") when called generically here.
const toJsonSchema = zodToJsonSchema as (schema: unknown) => unknown;
import registerTool from './plugins/register.js';
import loginTool from './plugins/login.js';
import whoamiTool from './plugins/whoami.js';
import listRowsTool from './plugins/list_rows.js';
// esModuleInterop is off workspace-wide, so a default import here would read
// a nonexistent `.default` off webpack's raw JSON module (module.exports is
// the array itself) and silently resolve to undefined — import-equals avoids
// that interop entirely.
import enabledList = require('./tools.enabled.json');

// Every plugin file's default export is listed here explicitly rather than
// discovered via fs.readdirSync(plugins/) — the "serve"/"build" targets bundle
// the whole app into a single dist/main.js via webpack (see webpack.config.js),
// so runtime directory scanning would silently find zero files in production
// even though it appears to work under a dev-time loader. Adding a new plugin
// means adding both the file and this line.
const ALL_PLUGINS: ToolDefinition[] = [registerTool, loginTool, whoamiTool, listRowsTool];

export interface ToolCatalogEntry {
  name: string;
  description: string;
  inputSchema: unknown;
  mutates: boolean;
  destructive: boolean;
  requiredRoles: string[];
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(plugins: ToolDefinition[] = ALL_PLUGINS, enabled: string[] = enabledList) {
    const seen = new Map<string, ToolDefinition>();
    for (const def of plugins) {
      const existing = seen.get(def.name);
      if (existing) {
        throw new Error(`Duplicate tool name "${def.name}" registered more than once — tool names must be unique`);
      }
      seen.set(def.name, def);
    }

    const enabledSet = new Set(enabled);
    for (const def of plugins) {
      if (enabledSet.has(def.name)) {
        this.tools.set(def.name, def);
      }
    }
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  catalogForListing(): ToolCatalogEntry[] {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: toJsonSchema(tool.inputSchema),
      mutates: tool.mutates,
      destructive: tool.destructive ?? false,
      requiredRoles: tool.requiredRoles ?? [],
    }));
  }
}
