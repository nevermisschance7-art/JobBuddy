"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

// A small column chart of one count per day (one series, so no legend: the title names it).
// Columns grow from one baseline with a 4px rounded top, a light grid, and a tooltip on
// hover or keyboard focus for every day. "Show as table" gives the same numbers as text.

export type DailyPoint = { day: string; value: number };

const W = 420;
const H = 150;
const PAD = { top: 10, right: 6, bottom: 22, left: 30 };
const MAX_BAR = 24;

/** 1, 2, 5, 10, 20, 50... at or above n (at least 4, so a quiet chart still has a scale). */
function niceMax(n: number): number {
  const target = Math.max(4, n);
  const exp = 10 ** Math.floor(Math.log10(target));
  for (const step of [1, 2, 5, 10]) if (step * exp >= target) return step * exp;
  return 10 * exp;
}

const shortDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString([], {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

/** A column with a rounded top and a square bottom, as an SVG path. */
function column(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  const bottom = y + h;
  return `M${x},${bottom} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${bottom} Z`;
}

export function DailyColumns({
  title,
  points,
  series,
  unit,
}: {
  title: string;
  points: DailyPoint[];
  /** Validated chart colors: 1 blue, 2 orange. */
  series: 1 | 2;
  /** Singular noun for the tooltip and table, e.g. "job". */
  unit: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const total = points.reduce((s, p) => s + p.value, 0);
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const band = plotW / Math.max(1, points.length);
  const barW = Math.min(MAX_BAR, band * 0.62);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const fill = series === 1 ? "var(--viz-1)" : "var(--viz-2)";
  const plural = (n: number) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  // A date under every other column (and the last), so labels never collide.
  const labelEvery = points.length > 8 ? 2 : 1;
  const hovered = active === null ? null : points[active];

  return (
    <figure className="border-border bg-card flex flex-col gap-2 rounded-xl border p-4">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {plural(total)} in {points.length} days
        </span>
      </figcaption>

      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          role="img"
          aria-label={`${title}: ${plural(total)} in the last ${points.length} days`}
          onMouseLeave={() => setActive(null)}
        >
          {/* Recessive grid and scale: 0, half, top. */}
          {[0, max / 2, max].map((v) => (
            <g key={v}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(v)}
                y2={y(v)}
                className="stroke-border"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 6}
                y={y(v)}
                dy="0.32em"
                textAnchor="end"
                className="fill-muted-foreground text-[10px] tabular-nums"
              >
                {v}
              </text>
            </g>
          ))}

          {points.map((p, i) => {
            const x = PAD.left + band * i + (band - barW) / 2;
            const h = (p.value / max) * plotH;
            const showLabel = i % labelEvery === labelEvery - 1 || i === points.length - 1;
            return (
              <g key={p.day}>
                {h > 0 ? (
                  <path
                    d={column(x, y(p.value), barW, h)}
                    fill={fill}
                    opacity={active === null || active === i ? 1 : 0.45}
                  />
                ) : null}
                {showLabel ? (
                  <text
                    x={PAD.left + band * i + band / 2}
                    y={H - 6}
                    textAnchor="middle"
                    className="fill-muted-foreground text-[10px]"
                  >
                    {shortDay(p.day)}
                  </text>
                ) : null}
                {/* The whole day's band is the hover and focus target, not just the column. */}
                <rect
                  x={PAD.left + band * i}
                  y={PAD.top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${shortDay(p.day)}: ${plural(p.value)}`}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className="cursor-default outline-none"
                />
              </g>
            );
          })}
        </svg>

        {hovered && active !== null ? (
          <div
            role="status"
            className="border-border bg-card pointer-events-none absolute top-0 -translate-x-1/2 whitespace-nowrap rounded-md border px-2 py-1 text-xs shadow-md"
            style={{ left: `${((PAD.left + band * active + band / 2) / W) * 100}%` }}
          >
            <span className="text-muted-foreground">{shortDay(hovered.day)}</span>{" "}
            <span className="font-semibold tabular-nums">{plural(hovered.value)}</span>
          </div>
        ) : null}
      </div>

      <details className="text-xs">
        <summary className="text-muted-foreground cursor-pointer">Show as table</summary>
        <table className="mt-2 w-full">
          <tbody>
            {points.map((p) => (
              <tr key={p.day} className={cn("border-border border-t")}>
                <td className="py-0.5">{shortDay(p.day)}</td>
                <td className="py-0.5 text-right tabular-nums">{p.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
