"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

export function StartButton({ label = "Let's set you up" }: { label?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending}>
      {pending ? "One moment..." : label}
    </Button>
  );
}
