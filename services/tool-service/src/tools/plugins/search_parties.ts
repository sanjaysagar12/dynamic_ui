import { z } from 'zod';
import type { ToolDefinition } from '../types.js';
import { partyNameKey, publicParty } from '../../lib/partyName.js';

const inputSchema = z.object({
  query: z.string().optional(),
  role: z.enum(['SUPPLIER', 'CUSTOMER', 'ANY']).optional(),
  includeInactive: z.boolean().optional(),
});

type Args = z.infer<typeof inputSchema>;

const tool: ToolDefinition<Args> = {
  name: 'search_parties',
  description:
    "Find suppliers and customers by part of their name (ignores case, spacing, punctuation and 'Pvt Ltd'), optionally only suppliers or only customers. Use it to match what the user typed to an existing supplier or customer, and ALWAYS before adding a new one. An empty query lists them all.",
  inputSchema,
  mutates: false,
  display: {
    type: 'table',
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'type', label: 'Type' },
      { field: 'city', label: 'City' },
      { field: 'gstin', label: 'GSTIN' },
      { field: 'phone', label: 'Phone' },
    ],
  },
  handler: async (ctx, args) => {
    const query = args.query ?? '';
    const role = args.role ?? 'ANY';
    const key = partyNameKey(query);
    const parties = await ctx.prisma.party.findMany({
      where: {
        ...(args.includeInactive ? {} : { isActive: true }),
        ...(role === 'SUPPLIER' ? { isSupplier: true } : {}),
        ...(role === 'CUSTOMER' ? { isCustomer: true } : {}),
        ...(key
          ? {
              OR: [
                { nameKey: { contains: key } },
                { name: { contains: query.trim(), mode: 'insensitive' as const } },
                { gstin: { contains: query.replace(/\s+/g, '').toUpperCase() } },
              ],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
      take: 200,
    });
    return { ok: true, data: parties.map(publicParty) };
  },
};

export default tool;
