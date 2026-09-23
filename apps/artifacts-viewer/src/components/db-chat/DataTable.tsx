'use client';

import { useMemo, useState } from 'react';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import type { DisplaySpec, TableColumnSpec } from '../../lib/db-chat/types';
import { formatCellValue, getPath } from './dynamicUtils';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils/cn';

export interface DataTableProps {
  display: Extract<DisplaySpec, { type: 'table' }>;
  rows: Record<string, unknown>[];
}

const PAGE_SIZE = 10;

const POSITIVE_WORDS = ['paid', 'in stock', 'completed', 'approved', 'active', 'on track', 'success'];
const WARNING_WORDS = ['pending', 'low stock', 'in review', 'awaiting'];
const NEGATIVE_WORDS = ['overdue', 'out of stock', 'rejected', 'cancelled', 'canceled', 'failed'];

function badgeVariantForValue(value: string): 'positive' | 'warning' | 'negative' | 'neutral' {
  const v = value.toLowerCase();
  if (POSITIVE_WORDS.some((w) => v.includes(w))) return 'positive';
  if (WARNING_WORDS.some((w) => v.includes(w))) return 'warning';
  if (NEGATIVE_WORDS.some((w) => v.includes(w))) return 'negative';
  return 'neutral';
}

function deriveColumns(rows: Record<string, unknown>[]): TableColumnSpec[] {
  const first = rows[0];
  if (!first) return [];
  return Object.keys(first).map((key) => ({ field: key, label: key }));
}

function matchesHighlight(
  row: Record<string, unknown>,
  highlightIf: NonNullable<Extract<DisplaySpec, { type: 'table' }>['highlightIf']>,
): boolean {
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

export function DataTable({ display, rows }: DataTableProps) {
  const columns = display.columns.length > 0 ? display.columns : deriveColumns(rows);
  const [sort, setSort] = useState<{ field: string; dir: 'asc' | 'desc' } | null>(null);
  const [page, setPage] = useState(0);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = getPath(a, sort.field);
      const bv = getPath(b, sort.field);
      const an = Number(av);
      const bn = Number(bv);
      let cmp: number;
      if (!Number.isNaN(an) && !Number.isNaN(bn)) cmp = an - bn;
      else cmp = String(av ?? '').localeCompare(String(bv ?? ''));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [rows, sort]);

  const pageCount = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const pageRows = sortedRows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const toggleSort = (field: string) => {
    setPage(0);
    setSort((current) => {
      if (current?.field !== field) return { field, dir: 'asc' };
      if (current.dir === 'asc') return { field, dir: 'desc' };
      return null;
    });
  };

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 border border-subtle rounded-lg bg-surface">
        <Inbox className="h-5 w-5 text-tertiary" />
        <p className="text-[13px] text-tertiary">No rows found.</p>
      </div>
    );
  }

  return (
    <div className="border border-subtle rounded-lg overflow-hidden bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-surface-raised">
              {columns.map((col) => {
                const numeric = col.format === 'number' || col.format === 'currency';
                const active = sort?.field === col.field;
                return (
                  <th
                    key={col.field}
                    onClick={() => toggleSort(col.field)}
                    className={cn(
                      'px-3 py-2.5 font-semibold text-secondary border-b border-subtle whitespace-nowrap cursor-pointer select-none hover:text-primary',
                      numeric ? 'text-right' : 'text-left',
                    )}
                  >
                    <span className={cn('inline-flex items-center gap-1', numeric && 'flex-row-reverse')}>
                      {col.label}
                      {active &&
                        (sort?.dir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => {
              const highlighted = display.highlightIf ? matchesHighlight(row, display.highlightIf) : false;
              return (
                <tr key={i} className={cn('hover:bg-surface-hover', highlighted && 'bg-warning-soft')}>
                  {columns.map((col) => {
                    const raw = getPath(row, col.field);
                    const formatted = formatCellValue(raw, col.format);
                    const numeric = col.format === 'number' || col.format === 'currency';
                    return (
                      <td
                        key={col.field}
                        className={cn(
                          'px-3 py-2.5 border-b border-subtle whitespace-nowrap',
                          numeric ? 'text-right tabular-nums font-medium text-primary' : 'text-secondary',
                        )}
                      >
                        {col.format === 'badge' ? (
                          <Badge variant={badgeVariantForValue(formatted)}>{formatted}</Badge>
                        ) : (
                          formatted
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {sortedRows.length > PAGE_SIZE && (
        <div className="flex items-center justify-between px-3 py-2 border-t border-subtle">
          <span className="text-[12px] text-tertiary">
            Showing {page * PAGE_SIZE + 1}–{Math.min(sortedRows.length, page * PAGE_SIZE + PAGE_SIZE)} of {sortedRows.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="h-7 w-7 rounded-full flex items-center justify-center border border-subtle text-secondary disabled:opacity-40 hover:text-primary"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="text-[12px] text-secondary px-1">
              {page + 1} / {pageCount}
            </span>
            <button
              type="button"
              disabled={page >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              className="h-7 w-7 rounded-full flex items-center justify-center border border-subtle text-secondary disabled:opacity-40 hover:text-primary"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
