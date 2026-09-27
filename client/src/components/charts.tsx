import { useState } from 'react';
import { formatDate } from '../format';

// Small, accessible charts. Colours come from CSS tokens (--seq-1..4 for the
// sequential ramp, --bar for single-series bars), which have their own dark-mode steps.

export function GoalRing({ value, goal, size = 132 }: { value: number; goal: number; size?: number }) {
  const r = size / 2 - 9;
  const c = 2 * Math.PI * r;
  const pct = goal > 0 ? Math.min(1, value / goal) : 0;
  return (
    <div className="goal-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${value} of ${goal} books read this year`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth="10" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--brand-strong)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="goal-ring-label">
        <strong>{value}</strong>
        <span>of {goal}</span>
      </div>
    </div>
  );
}

function level(minutes: number) {
  if (minutes <= 0) return 0;
  if (minutes < 10) return 1;
  if (minutes < 20) return 2;
  if (minutes < 40) return 3;
  return 4;
}

/** Twelve weeks of reading minutes, one cell per day (columns are weeks). */
export function ActivityHeatmap({ days }: { days: { day: string; minutes: number }[] }) {
  const [hover, setHover] = useState<{ day: string; minutes: number; x: number; y: number } | null>(null);
  // Pad the start so columns line up Monday→Sunday.
  const first = new Date(`${days[0]?.day}T00:00:00Z`);
  const pad = (first.getUTCDay() + 6) % 7;
  const cells = [...Array(pad).fill(null), ...days] as ({ day: string; minutes: number } | null)[];
  const weeks: (typeof cells)[] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const total = days.reduce((a, d) => a + d.minutes, 0);
  const activeDays = days.filter((d) => d.minutes > 0).length;
  return (
    <figure className="heatmap">
      <div className="heatmap-grid" role="img" aria-label={`Reading activity: ${total} minutes over ${activeDays} of the last ${days.length} days`} onMouseLeave={() => setHover(null)}>
        {weeks.map((w, wi) => (
          <div key={wi} className="heatmap-col">
            {w.map((d, di) =>
              d ? (
                <span
                  key={di}
                  className={`heatmap-cell l${level(d.minutes)}`}
                  onMouseEnter={(e) => {
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    const p = (e.currentTarget.parentElement!.parentElement as HTMLElement).getBoundingClientRect();
                    setHover({ ...d, x: r.left - p.left + r.width / 2, y: r.top - p.top });
                  }}
                />
              ) : (
                <span key={di} className="heatmap-cell empty" />
              ),
            )}
          </div>
        ))}
        {hover && (
          <div className="chart-tip" style={{ left: hover.x, top: hover.y }}>
            <strong>{hover.minutes ? `${hover.minutes} min` : 'No reading'}</strong>
            <span>{formatDate(hover.day, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}</span>
          </div>
        )}
      </div>
      <figcaption className="heatmap-legend">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={`heatmap-cell l${l}`} />
        ))}
        <span>More</span>
      </figcaption>
    </figure>
  );
}

/** Single-series daily bars with a hover tooltip and a hidden table for screen readers. */
export function DailyBars({ data, label, unit }: { data: { day: string; value: number }[]; label: string; unit: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const n = data.length;
  return (
    <figure className="bars">
      <div className="bars-plot" onMouseLeave={() => setHover(null)}>
        <div className="bars-grid" aria-hidden>
          <span>{max}</span>
          <span />
          <span>0</span>
        </div>
        <div className="bars-row" aria-hidden>
          {data.map((d, i) => (
            <div key={d.day} className="bar-slot" onMouseEnter={() => setHover(i)}>
              <div className={`bar ${hover === i ? 'on' : ''}`} style={{ height: d.value ? `max(3px, ${(d.value / max) * 100}%)` : 0 }} />
            </div>
          ))}
        </div>
        {hover != null && (
          <div className="chart-tip" style={{ left: `${((hover + 0.5) / n) * 100}%`, bottom: `calc(${(data[hover]!.value / max) * 100}% + 6px)` }}>
            <strong>
              {data[hover]!.value} {unit}
            </strong>
            <span>{formatDate(data[hover]!.day, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}</span>
          </div>
        )}
      </div>
      <figcaption className="bars-axis">
        <span>{formatDate(data[0]?.day, { month: 'short', day: 'numeric', timeZone: 'UTC' })}</span>
        <span>{formatDate(data[n - 1]?.day, { month: 'short', day: 'numeric', timeZone: 'UTC' })}</span>
      </figcaption>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.day}>
              <th scope="row">{d.day}</th>
              <td>{d.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
