'use client';

import type { Provider, ProviderInfo } from '../../lib/chat/types';
import { theme, inputStyle } from '../../lib/ui/theme';

export interface ProviderSelectorProps {
  providers: ProviderInfo[];
  provider: Provider;
  onChange: (provider: Provider) => void;
}

export function ProviderSelector({ providers, provider, onChange }: ProviderSelectorProps) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.75rem', color: theme.color.textMuted }}>
      Model
      <select value={provider} onChange={(e) => onChange(e.target.value as Provider)} style={{ ...inputStyle, cursor: 'pointer' }}>
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label} ({p.model})
          </option>
        ))}
      </select>
    </label>
  );
}
