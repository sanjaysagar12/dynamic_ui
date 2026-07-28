import React from 'react';
import { render, waitFor, fireEvent, screen } from '@testing-library/react';
import Page from '../src/app/page';
import { SupabaseSessionProvider } from '../src/lib/supabase/supabase-session-context';

describe('Page', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/api/supabase/login')) {
        return {
          ok: true,
          json: async () => ({
            accessToken: 'test-token',
            refreshToken: 'test-refresh-token',
            user: { id: 'user-1', email: 'owner@example.com' },
            emailConfirmationRequired: false,
          }),
        };
      }

      if (url.includes('/api/artifacts')) {
        return {
          ok: true,
          json: async () => ({
            role: 'OWNER',
            artifacts: [{ slug: 'dashboard', title: 'Dashboard', roles: ['OWNER', 'STOREKEEPER'] }],
          }),
        };
      }

      return { ok: true, json: async () => ({}) };
    }) as jest.Mock;
  });

  it('should render successfully once logged in', async () => {
    const { baseElement } = render(
      <SupabaseSessionProvider>
        <Page />
      </SupabaseSessionProvider>,
    );

    // No session yet — the artifact browser stays gated behind login.
    expect(baseElement.querySelector('iframe')).toBeNull();

    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'owner@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(baseElement.querySelector('iframe')).toBeTruthy());
  });
});
