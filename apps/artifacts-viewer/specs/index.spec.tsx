import React from 'react';
import { render, waitFor } from '@testing-library/react';
import Page from '../src/app/page';

describe('Page', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/api/artifacts')) {
        return {
          ok: true,
          json: async () => ({ artifacts: [{ slug: 'dashboard', title: 'Dashboard', roles: ['admin', 'manager'] }] }),
        };
      }

      return { ok: true, json: async () => ({ token: 'test-token' }) };
    }) as jest.Mock;
  });

  it('should render successfully', async () => {
    const { baseElement } = render(<Page />);
    await waitFor(() => expect(baseElement.querySelector('iframe')).toBeTruthy());
  });
});
