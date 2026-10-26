import { cn } from "@/lib/utils";

const control =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(control, "h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-24", className)} {...props} />;
}

export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return <select className={cn(control, "h-10", className)} {...props} />;
}

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label className={cn("text-sm font-medium", className)} {...props} />;
}

/** Red asterisk for required fields; screen readers hear "required" instead. */
export function RequiredMark() {
  return (
    <>
      <span aria-hidden className="text-destructive ml-0.5">
        *
      </span>
      <span className="sr-only"> (required)</span>
    </>
  );
}

/** "* required" legend, shown once at the top of a form with required fields. */
export function RequiredLegend() {
  return (
    <p className="text-muted-foreground text-xs">
      <span aria-hidden className="text-destructive">
        *
      </span>{" "}
      required
    </p>
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  required = false,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <RequiredMark /> : null}
      </Label>
      {children}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("border-border bg-card text-card-foreground rounded-xl border p-6", className)}
      {...props}
    />
  );
}

export function FormMessage({ error, ok }: { error?: string; ok?: string }) {
  if (error) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {error}
      </p>
    );
  }
  if (ok) return <p className="text-muted-foreground text-sm">{ok}</p>;
  return null;
}
