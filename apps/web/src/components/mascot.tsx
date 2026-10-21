import { cn } from "@/lib/utils";

export type Mood = "happy" | "thinking" | "sleepy" | "celebrating" | "comforting";

// Byte: a tired but loyal office cat. A fuller set of moods arrives with the fun layer.
export function Mascot({
  mood = "happy",
  size = 72,
  className,
}: {
  mood?: Mood;
  size?: number;
  className?: string;
}) {
  const eyes =
    mood === "sleepy" ? (
      <>
        <path d="M34 50 q5 3 10 0" />
        <path d="M56 50 q5 3 10 0" />
      </>
    ) : mood === "celebrating" || mood === "happy" ? (
      <>
        <path d="M34 52 q5 -6 10 0" />
        <path d="M56 52 q5 -6 10 0" />
      </>
    ) : (
      <>
        <circle cx="39" cy="50" r="3.5" fill="currentColor" stroke="none" />
        <circle cx="61" cy="50" r="3.5" fill="currentColor" stroke="none" />
      </>
    );

  const mouth =
    mood === "comforting" ? (
      <path d="M44 64 q6 4 12 0" />
    ) : mood === "thinking" ? (
      <path d="M45 65 h10" />
    ) : (
      <path d="M44 62 q6 6 12 0" />
    );

  return (
    <svg
      role="img"
      aria-label={`Byte the cat, ${mood}`}
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={cn("text-foreground shrink-0", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 40 L26 14 L42 30 M78 40 L74 14 L58 30" />
      <ellipse cx="50" cy="55" rx="32" ry="28" />
      {eyes}
      <path d="M48 57 l2 2 l2 -2" />
      {mouth}
      <path d="M20 56 h-10 M20 62 h-9 M80 56 h10 M80 62 h9" />
      {mood === "celebrating" ? <path d="M84 18 l4 -6 M90 26 l7 -2 M80 12 l0 -7" /> : null}
      {mood === "thinking" ? <circle cx="86" cy="20" r="4" /> : null}
    </svg>
  );
}

export function MascotSays({ mood, children }: { mood?: Mood; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <Mascot mood={mood} />
      <div className="bg-muted rounded-xl px-4 py-3 text-sm">{children}</div>
    </div>
  );
}
