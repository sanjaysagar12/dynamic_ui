import { z } from 'zod';
import type { Material, PrismaClient } from '@prisma/client';
import type { ToolDefinition } from '../types.js';

const inputSchema = z.object({
  query: z.string(),
});

type Args = z.infer<typeof inputSchema>;

/**
 * Shared with create_material's duplicate-suspicion precondition — call this
 * plain function directly rather than re-invoking the tool through the HTTP
 * layer. Case-insensitive `contains` only for now; if near-duplicates with
 * different wording (not just casing/whitespace) slip through in testing,
 * that's a signal to look at pg_trgm trigram similarity, not to guess at it
 * speculatively now.
 */
export async function findMaterialsByName(
  prisma: Pick<PrismaClient, 'material'>,
  query: string,
): Promise<Material[]> {
  return prisma.material.findMany({
    where: { name: { contains: query, mode: 'insensitive' } },
  });
}

const tool: ToolDefinition<Args> = {
  name: 'search_materials',
  description: 'Search materials by name (case-insensitive substring match).',
  inputSchema,
  mutates: false,
  handler: async (ctx, args) => {
    const materials = await findMaterialsByName(ctx.prisma, args.query);
    return { ok: true, data: materials };
  },
};

export default tool;
