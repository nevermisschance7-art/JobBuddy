import { scoreBand } from "@/lib/job-display";
import { cn } from "@/lib/utils";

const BAND_COLOR = {
  great: "text-success",
  good: "text-info",
  fair: "text-warning",
  low: "text-muted-foreground",
} as const;

export function ScoreRing({ score, size = 56 }: { score: number; size?: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const filled = (Math.max(0, Math.min(100, score)) / 100) * c;
  return (
    <svg
      viewBox="0 0 56 56"
      width={size}
      height={size}
      role="img"
      aria-label={`Match score ${score} out of 100`}
      className={cn("shrink-0", BAND_COLOR[scoreBand(score)])}
    >
      <circle
        cx="28"
        cy="28"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.15"
        strokeWidth="5"
      />
      <circle
        cx="28"
        cy="28"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${c}`}
        transform="rotate(-90 28 28)"
      />
      <text
        x="28"
        y="28"
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-foreground text-[15px] font-semibold"
      >
        {score}
      </text>
    </svg>
  );
}
