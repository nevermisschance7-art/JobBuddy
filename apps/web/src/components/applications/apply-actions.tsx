"use client";

import { Check, ExternalLink } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { moveApplication } from "@/lib/actions/applications";

/** "Open application form" and "I applied" for one application. */
export function ApplyActions({
  applicationId,
  applyUrl,
  status,
}: {
  applicationId: string;
  applyUrl: string;
  status: string;
}) {
  const [current, setCurrent] = useState(status);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href={applyUrl}
        target="_blank"
        rel="noreferrer"
        className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-medium"
      >
        <ExternalLink size={15} /> Open application form
      </a>
      {current === "prepared" ? (
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await moveApplication(applicationId, "applied");
              setCurrent("applied");
            })
          }
        >
          <Check size={15} /> I applied
        </Button>
      ) : (
        <span className="text-success inline-flex items-center gap-1 text-sm font-medium">
          <Check size={15} /> Applied
        </span>
      )}
    </div>
  );
}
