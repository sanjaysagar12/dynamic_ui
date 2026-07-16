import 'server-only';
import { isRole, type Role } from '@org/shared-auth';
import { getBackendServiceUrl } from '../config/env';

export interface DevTokenResponse {
  token: string;
  role: Role;
}

export class BackendServiceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'BackendServiceError';
  }
}

/** Requests a development JWT from the Backend Service. Server-side only. */
export async function requestDevToken(role: string): Promise<DevTokenResponse> {
  if (!isRole(role)) {
    throw new BackendServiceError(`Invalid role: ${role}`, 400);
  }

  const url = new URL('/auth/dev-token', getBackendServiceUrl());
  url.searchParams.set('role', role);

  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    throw new BackendServiceError('Failed to obtain token from backend service', response.status);
  }

  const data = await response.json();
  return { token: data.token, role: data.role };
}
