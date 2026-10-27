import { resumeSchema } from "@jobbuddy/shared";
import { NextResponse, type NextRequest } from "next/server";
import { cvFileName } from "@/lib/cv/layout";
import { getUser } from "@/lib/supabase/server";

// Downloads the approved tailored CV of one application: ?format=pdf (default) or docx.

const TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const format = request.nextUrl.searchParams.get("format") === "docx" ? "docx" : "pdf";

  const { data: app } = await supabase
    .from("applications")
    .select("tailored_cv_pdf, tailored_cv_docx, tailored_resume_json, jobs(company_name)")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  const path = format === "pdf" ? app?.tailored_cv_pdf : app?.tailored_cv_docx;
  if (!app || !path) return NextResponse.json({ error: "Not approved yet" }, { status: 404 });

  const { data: blob } = await supabase.storage.from("cvs").download(path);
  if (!blob) return NextResponse.json({ error: "File missing" }, { status: 404 });

  const resume = resumeSchema.safeParse(app.tailored_resume_json);
  const company = (app.jobs as unknown as { company_name: string } | null)?.company_name ?? "";
  const name = resume.success ? cvFileName(resume.data, company) : "CV";
  return new NextResponse(blob, {
    headers: {
      "content-type": TYPES[format],
      "content-disposition": `attachment; filename="${name}.${format}"`,
      "cache-control": "private, no-store",
    },
  });
}
