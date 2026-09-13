import type { TableColumnSpec } from '../../lib/db-chat/types';

/** Reads a possibly-nested field off a row/object by dot path (e.g. "material.name") — several
 *  tool display specs reference a nested field this way rather than forcing every handler to
 *  flatten its return shape just for the UI. Generic across every table/card column, not a
 *  per-tool special case. */
export function getPath(obj: unknown, path: string): unknown {
  if (obj == null) return undefined;
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

export function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

export function formatCellValue(value: unknown, format?: TableColumnSpec['format']): string {
  if (isEmptyValue(value)) return '—';
  switch (format) {
    case 'currency':
      return `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
    case 'number':
      return Number(value).toLocaleString('en-IN');
    case 'date':
      return formatDate(value);
    case 'badge':
    case 'text':
    default:
      return String(value);
  }
}

function formatDate(value: unknown): string {
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
}
