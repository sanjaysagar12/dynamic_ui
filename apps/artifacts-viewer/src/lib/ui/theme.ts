import type { CSSProperties } from 'react';

/** Small shared style tokens so the hand-rolled inline styles across
 *  components read as one consistent design instead of N different guesses
 *  at the same gray. */
export const theme = {
  color: {
    bg: '#f6f7f9',
    surface: '#ffffff',
    border: '#e4e6eb',
    text: '#16181d',
    textMuted: '#6b7280',
    primary: '#2563eb',
    primaryHover: '#1d4ed8',
    primaryText: '#ffffff',
    primarySoft: '#eaf1ff',
    danger: '#dc2626',
    success: '#0a8a5f',
  },
  radius: '10px',
  radiusSm: '6px',
  shadow: '0 1px 2px rgba(16,24,40,0.04), 0 4px 16px rgba(16,24,40,0.08)',
} as const;

export const inputStyle: CSSProperties = {
  padding: '0.5rem 0.65rem',
  borderRadius: theme.radiusSm,
  border: `1px solid ${theme.color.border}`,
  fontSize: '0.9rem',
  fontFamily: 'inherit',
  background: theme.color.surface,
  color: theme.color.text,
};

export const primaryButtonStyle: CSSProperties = {
  padding: '0.5rem 0.9rem',
  borderRadius: theme.radiusSm,
  border: 'none',
  background: theme.color.primary,
  color: theme.color.primaryText,
  fontSize: '0.9rem',
  fontWeight: 600,
  cursor: 'pointer',
};

export const secondaryButtonStyle: CSSProperties = {
  padding: '0.5rem 0.9rem',
  borderRadius: theme.radiusSm,
  border: `1px solid ${theme.color.border}`,
  background: theme.color.surface,
  color: theme.color.text,
  fontSize: '0.9rem',
  fontWeight: 500,
  cursor: 'pointer',
};
