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
import searchMaterialsTool from './plugins/search_materials.js';
import createMaterialTool from './plugins/create_material.js';
import updateMaterialTool from './plugins/update_material.js';
import deactivateMaterialTool from './plugins/deactivate_material.js';
import getMaterialBalanceTool from './plugins/get_material_balance.js';
import createCustomerPoTool from './plugins/create_customer_po.js';
import createJobTool from './plugins/create_job.js';
import setJobBomTool from './plugins/set_job_bom.js';
import checkJobShortageTool from './plugins/check_job_shortage.js';
import getJobTool from './plugins/get_job.js';
import getJobBomVarianceTool from './plugins/get_job_bom_variance.js';
import createPurchaseOrderTool from './plugins/create_purchase_order.js';
import approvePurchaseOrderTool from './plugins/approve_purchase_order.js';
import rejectPurchaseOrderTool from './plugins/reject_purchase_order.js';
import recordGoodsReceiptTool from './plugins/record_goods_receipt.js';
import getPurchasePriceHistoryTool from './plugins/get_purchase_price_history.js';
import listPendingApprovalsTool from './plugins/list_pending_approvals.js';
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
const ALL_PLUGINS: ToolDefinition[] = [
  registerTool,
  loginTool,
  whoamiTool,
  listRowsTool,
  searchMaterialsTool,
  createMaterialTool,
  updateMaterialTool,
  deactivateMaterialTool,
  getMaterialBalanceTool,
  createCustomerPoTool,
  createJobTool,
  setJobBomTool,
  checkJobShortageTool,
  getJobTool,
  getJobBomVarianceTool,
  createPurchaseOrderTool,
  approvePurchaseOrderTool,
  rejectPurchaseOrderTool,
  recordGoodsReceiptTool,
  getPurchasePriceHistoryTool,
  listPendingApprovalsTool,
];

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
