import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ToolDefinition } from './types.js';

// Cast to a loose signature: the real overloads of zodToJsonSchema recurse
// deeply enough through a ZodType<any> that tsc hits TS2589 ("type
// instantiation is excessively deep") when called generically here.
const toJsonSchema = zodToJsonSchema as (schema: unknown) => unknown;
import registerTool from './plugins/register.js';
import createUserTool from './plugins/create_user.js';
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
import issueMaterialTool from './plugins/issue_material.js';
import returnMaterialTool from './plugins/return_material.js';
import closeJobTool from './plugins/close_job.js';
import getMovementHistoryTool from './plugins/get_movement_history.js';
import recordScrapInTool from './plugins/record_scrap_in.js';
import recordScrapSaleTool from './plugins/record_scrap_sale.js';
import startStockCountTool from './plugins/start_stock_count.js';
import submitCountLineTool from './plugins/submit_count_line.js';
import submitStockCountTool from './plugins/submit_stock_count.js';
import approveStockCountTool from './plugins/approve_stock_count.js';
import rejectStockCountTool from './plugins/reject_stock_count.js';
import reverseMovementTool from './plugins/reverse_movement.js';
import searchPartiesTool from './plugins/search_parties.js';
import createPartyTool from './plugins/create_party.js';
import updatePartyTool from './plugins/update_party.js';
import deactivatePartyTool from './plugins/deactivate_party.js';
import listSettingsTool from './plugins/list_settings.js';
import updateSettingTool from './plugins/update_setting.js';
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
  createUserTool,
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
  issueMaterialTool,
  returnMaterialTool,
  closeJobTool,
  getMovementHistoryTool,
  recordScrapInTool,
  recordScrapSaleTool,
  startStockCountTool,
  submitCountLineTool,
  submitStockCountTool,
  approveStockCountTool,
  rejectStockCountTool,
  reverseMovementTool,
  searchPartiesTool,
  createPartyTool,
  updatePartyTool,
  deactivatePartyTool,
  listSettingsTool,
  updateSettingTool,
];

export interface ToolCatalogEntry {
  name: string;
  description: string;
  inputSchema: unknown;
  mutates: boolean;
  destructive: boolean;
  requiredRoles: string[];
  form?: ToolDefinition['form'];
  display?: ToolDefinition['display'];
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

      // A tool silently missing its UI spec is a bug, not a runtime case to
      // fall back gracefully from — every mutating tool needs a form, every
      // read tool needs a display, authored deliberately, no generic
      // auto-derived fallback. Fail loudly at startup, same as the
      // duplicate-name check above.
      if (def.mutates && !def.form) {
        throw new Error(`Tool "${def.name}" mutates but has no form spec — every mutating tool must define one`);
      }
      if (!def.mutates && !def.display) {
        throw new Error(`Tool "${def.name}" is read-only but has no display spec — every read-only tool must define one`);
      }
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

  /** `role` is the caller's tool-service role, already verified by the HTTP layer (see
   *  tools.router.ts) — null when the request carried no (or an invalid/expired) token. Passing
   *  null returns every tool regardless of requiredRoles: GET /tools is also called with no auth
   *  at artifact-generation time (opencode's get_tools.ts), and that path's real security boundary
   *  is each tool's own requiredRoles check at execute time, not what this listing shows — it must
   *  keep seeing the full catalog. Only filter once a caller's role is actually known. */
  catalogForListing(role: string | null = null): ToolCatalogEntry[] {
    // Any requiresAuth: false tool is a UI-only, dedicated-form flow
    // (register/login today, whatever else joins that list later) — there's
    // no legitimate reason for a chat agent to ever see or call one, so it's
    // excluded from the agent-visible catalog on that basis alone, not by
    // name. This only changes what GET /tools *lists* — POST
    // /tools/:name/execute still calls these tools directly by name.
    const entries = Array.from(this.tools.values())
      .filter((tool) => tool.requiresAuth !== false)
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: toJsonSchema(tool.inputSchema),
        mutates: tool.mutates,
        destructive: tool.destructive ?? false,
        requiredRoles: tool.requiredRoles ?? [],
        form: tool.form,
        display: tool.display,
      }));

    if (role === null) return entries;
    return entries.filter((entry) => entry.requiredRoles.length === 0 || entry.requiredRoles.includes(role));
  }
}
