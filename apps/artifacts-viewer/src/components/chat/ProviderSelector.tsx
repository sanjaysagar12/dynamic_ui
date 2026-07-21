'use client';

import type { Provider, ProviderInfo } from '../../lib/chat/types';

export interface ProviderSelectorProps {
  providers: ProviderInfo[];
  provider: Provider;
  onChange: (provider: Provider) => void;
}

export function ProviderSelector({ providers, provider, onChange }: ProviderSelectorProps) {
  return (
    <label>
      Model:{' '}
      <select value={provider} onChange={(e) => onChange(e.target.value as Provider)}>
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label} ({p.model})
          </option>
        ))}
      </select>
    </label>
  );
}
