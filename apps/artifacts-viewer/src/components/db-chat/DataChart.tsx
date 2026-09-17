'use client';

import { useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import type { DisplaySpec } from '../../lib/db-chat/types';
import { formatCellValue, getPath } from './dynamicUtils';

export interface DataChartProps {
  display: Extract<DisplaySpec, { type: 'chart' }>;
  rows: Record<string, unknown>[];
}

const SERIES_COLORS = ['var(--chart-line-primary)', 'var(--chart-line-secondary)', 'var(--positive)', 'var(--warning)', 'var(--negative)'];

function toSortableTime(value: string): number | null {
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

function formatX(value: string): string {
  const t = toSortableTime(value);
  if (t === null) return value;
  return new Date(t).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md bg-accent-500 px-2.5 py-1.5 shadow-floating">
      <div className="text-[11px] text-on-accent mb-0.5" style={{ opacity: 0.8 }}>
        {formatX(label ?? '')}
      </div>
      {payload.map((p) => (
        <div key={p.name} className="text-[12px] font-semibold text-on-accent">
          {p.name ? `${p.name}: ` : ''}
          {formatCellValue(p.value, 'number')}
        </div>
      ))}
    </div>
  );
}

export function DataChart({ display, rows }: DataChartProps) {
  const { chartRows, seriesNames } = useMemo(() => {
    const points = rows
      .map((row) => ({
        x: String(getPath(row, display.xField) ?? ''),
        y: Number(getPath(row, display.yField)),
        series: display.seriesField ? String(getPath(row, display.seriesField) ?? '') : 'value',
      }))
      .filter((p) => p.x && !Number.isNaN(p.y));

    const xValues = Array.from(new Set(points.map((p) => p.x)));
    const allSortable = xValues.every((v) => toSortableTime(v) !== null);
    xValues.sort((a, b) => (allSortable ? toSortableTime(a)! - toSortableTime(b)! : a.localeCompare(b)));

    const names = Array.from(new Set(points.map((p) => p.series)));

    const chartRows = xValues.map((x) => {
      const entry: Record<string, string | number> = { x };
      for (const name of names) {
        const match = points.find((p) => p.x === x && p.series === name);
        if (match) entry[name] = match.y;
      }
      return entry;
    });

    return { chartRows, seriesNames: names };
  }, [rows, display.xField, display.yField, display.seriesField]);

  if (chartRows.length === 0) {
    return (
      <div className="border border-subtle rounded-lg bg-surface p-6 text-center">
        <p className="text-[13px] text-tertiary">No data to chart.</p>
      </div>
    );
  }

  const showLegend = seriesNames.length > 1;
  const ChartComponent = display.chartType === 'bar' ? BarChart : LineChart;

  return (
    <div className="border border-subtle rounded-xl bg-surface p-5">
      <div className="text-h2 text-primary mb-3">{display.title}</div>
      <ResponsiveContainer width="100%" height={260}>
        <ChartComponent data={chartRows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--chart-gridline)" vertical={false} />
          <XAxis
            dataKey="x"
            tickFormatter={formatX}
            tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--border-strong)' }} />
          {showLegend && <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-secondary)' }} />}
          {seriesNames.map((name, i) =>
            display.chartType === 'bar' ? (
              <Bar key={name} dataKey={name} fill={SERIES_COLORS[i % SERIES_COLORS.length]} radius={[4, 4, 0, 0]} />
            ) : (
              <Line
                key={name}
                type="monotone"
                dataKey={name}
                stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                strokeWidth={2.5}
                dot={{ r: 3, strokeWidth: 0, fill: SERIES_COLORS[i % SERIES_COLORS.length] }}
                activeDot={{ r: 5 }}
              />
            ),
          )}
        </ChartComponent>
      </ResponsiveContainer>
    </div>
  );
}
