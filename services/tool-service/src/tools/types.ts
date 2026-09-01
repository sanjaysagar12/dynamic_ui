import type { z } from 'zod';
import type { PrismaClient } from '@prisma/client';

export interface ToolContext {
  userId: string | null;
  email: string | null;
  role: string | null;
  prisma: PrismaClient;
}

export type ToolResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string };

export interface ToolDefinition<Args = any> {
  name: string;
  description: string;
  inputSchema: z.ZodType<Args>;
  requiresAuth?: boolean;
  requiredRoles?: string[];
  mutates: boolean;
  destructive?: boolean;
  handler: (ctx: ToolContext, args: Args) => Promise<ToolResult>;
}
