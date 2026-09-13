'use client';

import type { DisplaySpec } from '../../lib/db-chat/types';
import { theme } from '../../lib/ui/theme';
import { formatCellValue, getPath } from './dynamicUtils';
import { DynamicTable } from './DynamicTable';

interface DynamicCardProps {
  display: Extract<DisplaySpec, { type: 'card' }>;
  data: Record<string, unknown>;
}

export function DynamicCard({ display, data }: DynamicCardProps) {
  const subRows = display.subTable ? (getPath(data, display.subTable.field) as Record<string, unknown>[] | undefined) : undefined;

  return (
    <div
      style={{
        background: theme.color.surface,
        border: `1px solid ${theme.color.border}`,
        borderRadius: theme.radius,
        boxShadow: theme.shadow,
        padding: '0.9rem 1rem',
        fontSize: '0.88rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.6rem',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {display.fields.map((field) => (
          <div key={field.field} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
            <span style={{ color: theme.color.textMuted }}>{field.label}</span>
            {field.format === 'badge' ? (
              <span
                style={{
                  padding: '0.1rem 0.5rem',
                  borderRadius: '999px',
                  background: theme.color.primarySoft,
                  color: theme.color.primary,
                  fontSize: '0.75rem',
                  fontWeight: 600,
                }}
              >
                {formatCellValue(getPath(data, field.field), field.format)}
              </span>
            ) : (
              <span style={{ fontWeight: 500 }}>{formatCellValue(getPath(data, field.field), field.format)}</span>
            )}
          </div>
        ))}
      </div>

      {display.subTable && subRows && subRows.length > 0 && (
        <div style={{ marginTop: '0.3rem' }}>
          {display.subTable.title && (
            <div style={{ fontSize: '0.78rem', fontWeight: 600, color: theme.color.textMuted, marginBottom: '0.35rem' }}>
              {display.subTable.title}
            </div>
          )}
          <DynamicTable display={{ type: 'table', columns: display.subTable.columns }} rows={subRows} />
        </div>
      )}
    </div>
  );
}
