import React from 'react';
import { render, waitFor, fireEvent, screen } from '@testing-library/react';
import Page from '../src/app/page';
import { SessionProvider } from '../src/lib/session/session-context';

describe('Page', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/api/tools/login')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            data: { accessToken: 'test-token', userId: 'user-1', email: 'owner@example.com', role: 'OWNER' },
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
      <SessionProvider>
        <Page />
      </SessionProvider>,
    );

    // No session yet — the artifact browser stays gated behind login.
    expect(baseElement.querySelector('iframe')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Log in / Register' }));
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'owner@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(baseElement.querySelector('iframe')).toBeTruthy());
  });
});
