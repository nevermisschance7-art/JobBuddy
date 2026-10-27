import type { Resume } from "@jobbuddy/shared";
import { cvBlocks } from "@/lib/cv/layout";

/** The CV as the files will show it, in plain HTML. */
export function CvPreview({ resume }: { resume: Resume }) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      {cvBlocks(resume).map((b, i) => {
        switch (b.kind) {
          case "name":
            return (
              <p key={i} className="text-lg font-semibold">
                {b.text}
              </p>
            );
          case "contact":
            return (
              <p key={i} className="text-muted-foreground text-xs">
                {b.text}
              </p>
            );
          case "section":
            return (
              <p key={i} className="border-border mt-3 border-b text-xs font-semibold uppercase">
                {b.text}
              </p>
            );
          case "entry":
            return (
              <div key={i} className="mt-1">
                <p className="flex justify-between gap-2 font-medium">
                  <span>{b.title}</span>
                  <span className="text-muted-foreground shrink-0 text-xs font-normal">
                    {b.right}
                  </span>
                </p>
                {b.sub ? <p className="text-muted-foreground text-xs">{b.sub}</p> : null}
              </div>
            );
          case "paragraph":
            return <p key={i}>{b.text}</p>;
          case "bullet":
            return (
              <p key={i} className="pl-4 -indent-3">
                - {b.text}
              </p>
            );
        }
      })}
    </div>
  );
}
