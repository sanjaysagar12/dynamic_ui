import type { ToolCatalogEntry } from './tool-service-client.js';

/**
 * A small, explicit allowlist from mutating tool name -> read-only follow-up work to do once that
 * write succeeds — not a generic "run any tool after any tool" system. Same philosophy as
 * list-rows-allowlist.ts's table/column allowlist: enumerate exactly what's permitted, reject
 * everything else.
 */
export interface PostWriteHook {
  /** Read-only tools to call automatically after the triggering tool succeeds. Every entry MUST
   *  resolve to a `mutates: false` tool in the live catalog — see validatePostWriteHooks. */
  followUpTools: Array<{
    tool: string;
    /** Builds this follow-up call's args from the original write's args/result. */
    buildArgs: (writeArgs: Record<string, unknown>, writeResult: unknown) => Record<string, unknown>;
  }>;
  /** Guidance for the one-more-turn model call that narrates the follow-up results — describes
   *  what kind of proactive note to write, not literal text to show. */
  followUpInstruction: string;
}

export const POST_WRITE_HOOKS: Record<string, PostWriteHook> = {
  set_job_bom: {
    followUpTools: [
      {
        tool: 'check_job_shortage',
        buildArgs: (writeArgs) => ({ jobId: (writeArgs as { jobId: string }).jobId }),
      },
    ],
    followUpInstruction:
      'The job BOM was just saved successfully. Given the shortage check result below, write a ' +
      'short, natural confirmation. If there is a shortfall on any material, mention it plainly ' +
      'and offer to raise a purchase order for it — but do not raise one yourself; this is an ' +
      "offer the user must accept in their next message, not an action to take now. If there's " +
      'no shortfall, just confirm the save plainly — do not invent a shortage that is not in the data.',
  },
};

/** Fails loudly at startup (mirrors tool-service's ToolRegistry constructor) if a hook ever
 *  references a tool that doesn't exist, or references a mutating one as a follow-up — chaining
 *  into another write would recreate the unconfirmed-write problem this whole mechanism exists to
 *  avoid, so it must never be possible to configure, not just discouraged. */
export function validatePostWriteHooks(catalog: ToolCatalogEntry[]): void {
  const byName = new Map(catalog.map((entry) => [entry.name, entry]));

  for (const [triggerName, hook] of Object.entries(POST_WRITE_HOOKS)) {
    const trigger = byName.get(triggerName);
    if (!trigger) {
      throw new Error(`post-write hook registered for unknown tool "${triggerName}"`);
    }
    if (!trigger.mutates) {
      throw new Error(`post-write hook registered for "${triggerName}", which is not a mutating tool`);
    }

    for (const step of hook.followUpTools) {
      const followUp = byName.get(step.tool);
      if (!followUp) {
        throw new Error(`post-write hook for "${triggerName}" references unknown follow-up tool "${step.tool}"`);
      }
      if (followUp.mutates) {
        throw new Error(
          `post-write hook for "${triggerName}" references "${step.tool}", which mutates — follow-up tools must be ` +
            'read-only (mutates: false)',
        );
      }
    }
  }
}
