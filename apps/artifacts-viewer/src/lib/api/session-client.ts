export type ToolResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string };

export interface SessionData {
  accessToken: string;
  userId: string;
  email: string;
  role: string;
}

/** Calls this app's own /api/tools/login BFF route. Client-side. */
export async function sessionLogin(email: string, password: string): Promise<ToolResult<SessionData>> {
  const response = await fetch('/api/tools/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return response.json();
}

/** Calls this app's own /api/tools/register BFF route. Client-side. */
export async function sessionRegister(email: string, password: string, role?: string): Promise<ToolResult<SessionData>> {
  const response = await fetch('/api/tools/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, ...(role ? { role } : {}) }),
  });
  return response.json();
}
