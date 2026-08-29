import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FormRequestCard } from '../src/components/db-chat/FormRequestCard';
import type { FormSpec } from '../src/lib/db-chat/types';

const form: FormSpec = {
  table: 'products',
  operation: 'insert',
  fields: [
    { name: 'name', label: 'Name', type: 'text', required: true },
    {
      name: 'category_id',
      label: 'Category',
      type: 'foreign_key',
      required: true,
      referenceTable: 'categories',
      referenceLabelColumn: 'name',
    },
    { name: 'notes', label: 'Notes', type: 'text', required: false },
  ],
};

describe('FormRequestCard', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/data/categories')) {
        return {
          ok: true,
          json: async () => ({ data: [{ id: 'cat-1', name: 'Widgets' }, { id: 'cat-2', name: 'Gadgets' }] }),
        };
      }
      return { ok: true, json: async () => ({}) };
    }) as jest.Mock;
  });

  it('blocks Review until required fields are filled, and never prefills them', async () => {
    render(<FormRequestCard form={form} messages={[]} token="test-token" onDone={jest.fn()} onCancel={jest.fn()} />);

    const nameInput = screen.getByLabelText(/Name/) as HTMLInputElement;
    expect(nameInput.value).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Review' }));

    await waitFor(() => expect(screen.getByText(/the agent won't invent a value/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
  });

  it('fetches foreign_key options from the referenced table and renders them by label', async () => {
    render(<FormRequestCard form={form} messages={[]} token="test-token" onDone={jest.fn()} onCancel={jest.fn()} />);

    await waitFor(() => expect(screen.getByText('Widgets')).toBeTruthy());
    expect(screen.getByText('Gadgets')).toBeTruthy();
  });

  it('advances to the review step once required fields are filled', async () => {
    render(<FormRequestCard form={form} messages={[]} token="test-token" onDone={jest.fn()} onCancel={jest.fn()} />);

    await waitFor(() => expect(screen.getByText('Widgets')).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'Widget A' } });
    fireEvent.change(screen.getByLabelText(/Category/), { target: { value: 'cat-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy());
    expect(screen.getByText('Widget A')).toBeTruthy();
  });
});
