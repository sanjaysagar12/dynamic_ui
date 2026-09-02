import { z } from 'zod';
import * as bcrypt from 'bcrypt';
import type { ToolDefinition } from '../types.js';
import { signToken } from '../../auth/jwt.js';
import { loadConfig } from '../../config.js';

const inputSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

type Args = z.infer<typeof inputSchema>;

const config = loadConfig();

const tool: ToolDefinition<Args> = {
  name: 'login',
  description: 'Authenticate with email and password, returning an access token.',
  inputSchema,
  requiresAuth: false,
  mutates: false,
  // login is a query (mutates: false, correctly — it writes nothing), so
  // per the mutates<->form / !mutates<->display invariant it takes a
  // display, not a form. The actual login UI is AuthWidget's own dedicated
  // popup, not this generic renderer; this card is what the db-agent-chat
  // path would show if login were ever called through it.
  display: {
    type: 'card',
    fields: [
      { field: 'userId', label: 'User ID' },
      { field: 'email', label: 'Email' },
      { field: 'role', label: 'Role', format: 'badge' },
    ],
  },
  handler: async (ctx, args) => {
    const user = await ctx.prisma.user.findUnique({ where: { email: args.email } });
    // Same INVALID_CREDENTIALS error whether the email doesn't exist or the
    // password is wrong — never leak which one it was.
    if (!user) {
      return { ok: false, error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' };
    }

    const passwordMatches = await bcrypt.compare(args.password, user.passwordHash);
    if (!passwordMatches) {
      return { ok: false, error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' };
    }

    const accessToken = signToken({ sub: user.id, email: args.email, role: user.role }, config.jwtSecret);

    return { ok: true, data: { accessToken, userId: user.id, email: args.email, role: user.role } };
  },
};

export default tool;
