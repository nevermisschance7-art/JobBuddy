import { strToU8, zipSync } from "fflate";
import { NextResponse } from "next/server";
import { getUser } from "@/lib/supabase/server";

// "Export my data": every personal row as JSON plus the stored CV files, in one zip.
// Encrypted AI keys are left out; only which providers are set is included.

const TABLES = [
  "profiles",
  "cvs",
  "filters",
  "fixed_answers",
  "user_job_matches",
  "applications",
  "answer_memory",
  "learned_answers",
  "employer_messages",
  "events",
] as const;

export async function GET() {
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const data: Record<string, unknown> = {};
  for (const table of TABLES) {
    // Every table here has user_id; the cast keeps the typed client happy with a loop.
    const { data: rows } = await supabase
      .from(table as "events")
      .select("*")
      .eq("user_id", user.id);
    data[table] = rows ?? [];
  }
  const { data: keys } = await supabase
    .from("ai_keys")
    .select("provider, last_error, created_at")
    .eq("user_id", user.id);
  data.ai_keys = keys ?? [];

  const files: Record<string, Uint8Array> = {
    "jobbuddy-data.json": strToU8(JSON.stringify(data, null, 2)),
  };
  const { data: stored } = await supabase.storage.from("cvs").list(user.id, { limit: 1000 });
  for (const f of stored ?? []) {
    const { data: blob } = await supabase.storage.from("cvs").download(`${user.id}/${f.name}`);
    if (blob) files[`files/${f.name}`] = new Uint8Array(await blob.arrayBuffer());
  }

  const zip = zipSync(files);
  return new NextResponse(Buffer.from(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="jobbuddy-export-${new Date().toISOString().slice(0, 10)}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
