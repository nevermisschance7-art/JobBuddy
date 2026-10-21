import Link from "next/link";
import { CvUpload } from "@/components/forms/cv-upload";
import { ResumeEditor } from "@/components/forms/resume-editor";
import { MascotSays } from "@/components/mascot";
import { Card } from "@/components/ui/field";
import { loadLatestCv } from "@/lib/loaders";
import { nextStep } from "../steps";

export default async function CvStep() {
  const cv = await loadLatestCv();
  const next = nextStep("/onboarding/cv");

  return (
    <>
      <MascotSays mood={cv ? "thinking" : "happy"}>
        {cv
          ? "Here's what I read. Fix anything that's wrong or missing. I'll only ever use what you confirm here."
          : "First, your CV. I'll read it and turn it into a form you can check."}
      </MascotSays>
      <Card className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">Your CV</h1>
        <CvUpload hasCv={Boolean(cv)} />
      </Card>
      {cv ? (
        <ResumeEditor
          key={cv.id}
          cvId={cv.id}
          resume={cv.resume}
          confirmed={cv.confirmed}
          next={next}
        />
      ) : null}
      {cv?.confirmed ? (
        <Link href={next} className="self-end text-sm underline">
          Skip to next step
        </Link>
      ) : null}
    </>
  );
}
