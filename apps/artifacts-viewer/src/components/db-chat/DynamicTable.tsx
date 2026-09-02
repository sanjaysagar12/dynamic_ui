'use client';

import type { CSSProperties } from 'react';
import type { DisplaySpec, TableColumnSpec } from '../../lib/db-chat/types';
import { theme } from '../../lib/ui/theme';
import { formatCellValue, getPath } from './dynamicUtils';

interface DynamicTableProps {
  display: Extract<DisplaySpec, { type: 'table' }>;
  rows: Record<string, unknown>[];
}

/** Derives columns from the keys of the first row — only ever used for list_rows, the one tool
 *  whose display genuinely can't be authored in advance (its `table` arg is chosen at call time).
 *  Every other tool always ships real columns, so this fallback never applies to them. */
function deriveColumns(rows: Record<string, unknown>[]): TableColumnSpec[] {
  const first = rows[0];
  if (!first) return [];
  return Object.keys(first).map((key) => ({ field: key, label: key }));
}

function matchesHighlight(row: Record<string, unknown>, highlightIf: NonNullable<Extract<DisplaySpec, { type: 'table' }>['highlightIf']>): boolean {
  const value = getPath(row, highlightIf.field);
  const num = Number(value);
  switch (highlightIf.op) {
    case 'gt':
      return !Number.isNaN(num) && num > Number(highlightIf.value);
    case 'lt':
      return !Number.isNaN(num) && num < Number(highlightIf.value);
    case 'neq':
      return value !== highlightIf.value;
    default:
      return false;
  }
}

const cellStyle: CSSProperties = {
  padding: '0.45rem 0.6rem',
  fontSize: '0.83rem',
  borderBottom: `1px solid ${theme.color.border}`,
  textAlign: 'left',
  whiteSpace: 'nowrap',
};

export function DynamicTable({ display, rows }: DynamicTableProps) {
  const columns = display.columns.length > 0 ? display.columns : deriveColumns(rows);

  if (rows.length === 0) {
    return <p style={{ color: theme.color.textMuted, fontSize: '0.85rem', margin: 0 }}>No rows found.</p>;
  }

  return (
    <div style={{ overflowX: 'auto', border: `1px solid ${theme.color.border}`, borderRadius: theme.radius }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr style={{ background: theme.color.bg }}>
            {columns.map((col) => (
              <th key={col.field} style={{ ...cellStyle, fontWeight: 600, color: theme.color.textMuted }}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const highlighted = display.highlightIf ? matchesHighlight(row, display.highlightIf) : false;
            return (
              <tr key={i} style={highlighted ? { background: '#fff4e5' } : undefined}>
                {columns.map((col) => (
                  <td key={col.field} style={cellStyle}>
                    {col.format === 'badge' ? (
                      <span
                        style={{
                          padding: '0.15rem 0.5rem',
                          borderRadius: '999px',
                          background: theme.color.primarySoft,
                          color: theme.color.primary,
                          fontSize: '0.75rem',
                          fontWeight: 600,
                        }}
                      >
                        {formatCellValue(getPath(row, col.field), col.format)}
                      </span>
                    ) : (
                      formatCellValue(getPath(row, col.field), col.format)
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
