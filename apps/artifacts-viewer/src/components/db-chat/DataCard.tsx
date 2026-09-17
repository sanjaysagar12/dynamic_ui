'use client';

import type { DisplaySpec } from '../../lib/db-chat/types';
import { formatCellValue, getPath } from './dynamicUtils';
import { DataTable } from './DataTable';
import { Badge } from '../ui/badge';

export interface DataCardProps {
  display: Extract<DisplaySpec, { type: 'card' }>;
  data: Record<string, unknown>;
}

export function DataCard({ display, data }: DataCardProps) {
  const subRows = display.subTable ? (getPath(data, display.subTable.field) as Record<string, unknown>[] | undefined) : undefined;

  return (
    <div className="border border-subtle rounded-xl bg-surface shadow-card p-5 flex flex-col gap-4 text-[13px]">
      <div className="flex flex-col gap-2.5">
        {display.fields.map((field) => (
          <div key={field.field} className="flex items-center justify-between gap-4">
            <span className="text-secondary">{field.label}</span>
            {field.format === 'badge' ? (
              <Badge>{formatCellValue(getPath(data, field.field), field.format)}</Badge>
            ) : (
              <span className="font-semibold text-primary tabular-nums">
                {formatCellValue(getPath(data, field.field), field.format)}
              </span>
            )}
          </div>
        ))}
      </div>

      {display.subTable && subRows && subRows.length > 0 && (
        <div>
          {display.subTable.title && <div className="text-micro text-tertiary mb-2">{display.subTable.title.toUpperCase()}</div>}
          <DataTable display={{ type: 'table', columns: display.subTable.columns }} rows={subRows} />
        </div>
      )}
    </div>
  );
}
