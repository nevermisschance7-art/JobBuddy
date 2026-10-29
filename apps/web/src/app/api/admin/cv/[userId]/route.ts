import { NextResponse } from "next/server";
import { adminAccess } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/server";

// The CV file a user uploaded (their newest), for the admin page. Admins only.
export async function GET(_request: Request, { params }: { params: Promise<{ userId: string }> }) {
  if ((await adminAccess()) !== "ok") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { userId } = await params;
  const admin = createAdminClient();
  const { data: cv } = await admin
    .from("cvs")
    .select("original_file")
    .eq("user_id", userId)
    .not("original_file", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!cv?.original_file) return NextResponse.json({ error: "No CV" }, { status: 404 });
  const { data } = await admin.storage.from("cvs").createSignedUrl(cv.original_file, 60, {
    download: true,
  });
  if (!data?.signedUrl) return NextResponse.json({ error: "File missing" }, { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}
