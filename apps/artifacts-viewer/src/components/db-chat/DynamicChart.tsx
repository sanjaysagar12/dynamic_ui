'use client';

import type { DisplaySpec } from '../../lib/db-chat/types';
import { theme } from '../../lib/ui/theme';
import { formatCellValue, getPath } from './dynamicUtils';

interface DynamicChartProps {
  display: Extract<DisplaySpec, { type: 'chart' }>;
  rows: Record<string, unknown>[];
}

// No charting library is a dependency of this app yet — rather than add one for a handful of
// line/bar charts, this hand-rolls plain SVG, matching the rest of this app's hand-rolled-inline-
// style convention (theme.ts) instead of pulling in a new dependency.
const SERIES_COLORS = ['#2563eb', '#0a8a5f', '#dc2626', '#9333ea', '#d97706', '#0891b2'];

const WIDTH = 640;
const HEIGHT = 280;
const MARGIN = { top: 24, right: 16, bottom: 48, left: 56 };

function toSortableTime(value: string): number | null {
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

function formatX(value: string): string {
  const t = toSortableTime(value);
  if (t === null) return value;
  return new Date(t).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export function DynamicChart({ display, rows }: DynamicChartProps) {
  const points = rows
    .map((row) => ({
      x: String(getPath(row, display.xField) ?? ''),
      y: Number(getPath(row, display.yField)),
      series: display.seriesField ? String(getPath(row, display.seriesField) ?? '') : '',
    }))
    .filter((p) => p.x && !Number.isNaN(p.y));

  if (points.length === 0) {
    return <p style={{ color: theme.color.textMuted, fontSize: '0.85rem', margin: 0 }}>No data to chart.</p>;
  }

  const xValues = Array.from(new Set(points.map((p) => p.x)));
  const allSortable = xValues.every((v) => toSortableTime(v) !== null);
  xValues.sort((a, b) => (allSortable ? toSortableTime(a)! - toSortableTime(b)! : a.localeCompare(b)));

  const seriesNames = Array.from(new Set(points.map((p) => p.series)));
  const showLegend = seriesNames.length > 1 || seriesNames[0] !== '';

  const maxY = Math.max(...points.map((p) => p.y), 0);
  const yTop = maxY === 0 ? 1 : maxY * 1.1;

  const plotW = WIDTH - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;

  const xPos = (x: string) => {
    const i = xValues.indexOf(x);
    return xValues.length <= 1 ? plotW / 2 : (i / (xValues.length - 1)) * plotW;
  };
  const yPos = (y: number) => plotH - (y / yTop) * plotH;

  const yTicks = 4;
  const yTickValues = Array.from({ length: yTicks + 1 }, (_, i) => (yTop / yTicks) * i);

  const seriesData = seriesNames.map((name, i) => ({
    name,
    color: SERIES_COLORS[i % SERIES_COLORS.length],
    points: points.filter((p) => p.series === name).sort((a, b) => xValues.indexOf(a.x) - xValues.indexOf(b.x)),
  }));

  const barGroupWidth = xValues.length > 0 ? plotW / xValues.length : plotW;
  const barWidth = Math.max(2, (barGroupWidth * 0.7) / Math.max(1, seriesData.length));

  return (
    <div style={{ background: theme.color.surface, border: `1px solid ${theme.color.border}`, borderRadius: theme.radius, padding: '0.75rem 0.9rem' }}>
      <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: theme.color.text }}>{display.title}</div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {yTickValues.map((tv, i) => (
            <g key={i}>
              <line x1={0} x2={plotW} y1={yPos(tv)} y2={yPos(tv)} stroke={theme.color.border} strokeWidth={1} />
              <text x={-8} y={yPos(tv)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill={theme.color.textMuted}>
                {formatCellValue(tv, 'number')}
              </text>
            </g>
          ))}

          {xValues.map((x) => (
            <text key={x} x={xPos(x)} y={plotH + 18} textAnchor="middle" fontSize={10} fill={theme.color.textMuted}>
              {formatX(x)}
            </text>
          ))}

          {display.chartType === 'line'
            ? seriesData.map((s) => (
                <g key={s.name}>
                  <polyline
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2}
                    points={s.points.map((p) => `${xPos(p.x)},${yPos(p.y)}`).join(' ')}
                  />
                  {s.points.map((p, i) => (
                    <circle key={i} cx={xPos(p.x)} cy={yPos(p.y)} r={3} fill={s.color}>
                      <title>{`${s.name ? s.name + ' — ' : ''}${formatX(p.x)}: ${formatCellValue(p.y, 'number')}`}</title>
                    </circle>
                  ))}
                </g>
              ))
            : seriesData.map((s, si) => (
                <g key={s.name}>
                  {s.points.map((p, i) => {
                    const groupX = xPos(p.x) - barGroupWidth / 2 + si * barWidth + (barGroupWidth - seriesData.length * barWidth) / 2;
                    const barH = plotH - yPos(p.y);
                    return (
                      <rect key={i} x={groupX} y={yPos(p.y)} width={barWidth} height={Math.max(0, barH)} fill={s.color}>
                        <title>{`${s.name ? s.name + ' — ' : ''}${formatX(p.x)}: ${formatCellValue(p.y, 'number')}`}</title>
                      </rect>
                    );
                  })}
                </g>
              ))}
        </g>
      </svg>
      {showLegend && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.4rem' }}>
          {seriesData.map((s) => (
            <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', color: theme.color.textMuted }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: s.color, display: 'inline-block' }} />
              {s.name || '—'}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
