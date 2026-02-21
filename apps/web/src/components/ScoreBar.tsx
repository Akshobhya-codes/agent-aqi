"use client";

interface ScoreBarProps {
  label: string;
  value: number;
  weight?: number;
}

function barColor(v: number) {
  if (v >= 75) return "var(--green)";
  if (v >= 45) return "var(--yellow)";
  return "var(--red)";
}

export default function ScoreBar({ label, value, weight }: ScoreBarProps) {
  return (
    <div style={{ marginBottom: "0.75rem" }}>
      <div className="flex items-center" style={{ justifyContent: "space-between" }}>
        <span>
          {label}
          {weight != null && (
            <span className="muted" style={{ fontSize: 11, marginLeft: 4 }}>
              ×{weight}
            </span>
          )}
        </span>
        <strong style={{ color: barColor(value) }}>{value.toFixed(1)}</strong>
      </div>
      <div className="bar-wrap">
        <div
          className="bar-fill"
          style={{ width: `${value}%`, background: barColor(value) }}
        />
      </div>
    </div>
  );
}
