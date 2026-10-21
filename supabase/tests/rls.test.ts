// Proves user A cannot read or write user B's data, and that shared tables are read-only.
// Runs against the real Supabase project with two throwaway users, deleted afterwards.
// Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY
// (read from apps/web/.env.local).
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(url && anonKey && serviceKey);

type TestUser = { id: string; client: SupabaseClient };

const run = randomUUID().slice(0, 8);
let admin: SupabaseClient;
let a: TestUser;
let b: TestUser;
let anon: SupabaseClient;
let jobId: string;

const pdf = () => new Blob(["%PDF-1.4"], { type: "application/pdf" });

async function makeUser(label: string): Promise<TestUser> {
  const email = `rls-${label}-${run}@jobbuddy.test`;
  const password = randomUUID();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { id: data.user.id, client };
}

describe.skipIf(!configured)("RLS isolation", () => {
  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    anon = createClient(url!, anonKey!, { auth: { persistSession: false } });
    a = await makeUser("a");
    b = await makeUser("b");

    const job = await admin
      .from("jobs")
      .insert({
        source: "rls-test",
        external_id: run,
        canonical_url: `https://example.com/jobs/${run}`,
        apply_url: `https://example.com/jobs/${run}`,
        title: "RLS Test Engineer",
        company_name: "RLS Test Co",
      })
      .select("id")
      .single();
    if (job.error) throw job.error;
    jobId = job.data.id;

    // User A's personal data, written as A.
    const writes = await Promise.all([
      a.client.from("cvs").insert({ user_id: a.id, resume_json: { basics: { name: "A" } } }),
      a.client
        .from("fixed_answers")
        .insert({ user_id: a.id, key: "notice_period", value: "1 month" }),
      a.client.from("ai_keys").insert({ user_id: a.id, provider: "gemini", encrypted_key: "x" }),
      a.client.from("applications").insert({ user_id: a.id, job_id: jobId }),
      a.client.from("events").insert({ user_id: a.id, type: "test" }),
      a.client.storage
        .from("cvs")
        .upload(`${a.id}/cv.pdf`, pdf(), { contentType: "application/pdf" }),
    ]);
    for (const w of writes) if (w.error) throw w.error;
  });

  afterAll(async () => {
    if (!admin) return;
    if (a) await admin.storage.from("cvs").remove([`${a.id}/cv.pdf`]);
    // Applications restrict job deletion, so users (and their cascading rows) go first.
    for (const u of [a, b]) if (u) await admin.auth.admin.deleteUser(u.id);
    if (jobId) await admin.from("jobs").delete().eq("id", jobId);
  });

  it("creates a profile and filters row on sign-up", async () => {
    const p = await a.client.from("profiles").select("user_id").single();
    const f = await a.client.from("filters").select("user_id").single();
    expect(p.data?.user_id).toBe(a.id);
    expect(f.data?.user_id).toBe(a.id);
  });

  it("A can read A's own data", async () => {
    const { data } = await a.client.from("fixed_answers").select("value");
    expect(data).toEqual([{ value: "1 month" }]);
  });

  for (const table of [
    "profiles",
    "cvs",
    "filters",
    "fixed_answers",
    "ai_keys",
    "applications",
    "events",
  ]) {
    it(`B cannot read A's ${table}`, async () => {
      const { data, error } = await b.client.from(table).select("*").eq("user_id", a.id);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  }

  it("B cannot update A's rows", async () => {
    await b.client.from("fixed_answers").update({ value: "hacked" }).eq("user_id", a.id);
    const { data } = await a.client.from("fixed_answers").select("value").single();
    expect(data?.value).toBe("1 month");
  });

  it("B cannot delete A's rows", async () => {
    await b.client.from("events").delete().eq("user_id", a.id);
    const { data } = await a.client.from("events").select("id");
    expect(data).toHaveLength(1);
  });

  it("B cannot insert rows owned by A", async () => {
    const { error } = await b.client
      .from("fixed_answers")
      .insert({ user_id: a.id, key: "salary_expectation", value: "1" });
    expect(error).not.toBeNull();
  });

  it("B cannot take over A's row by changing user_id", async () => {
    await b.client.from("cvs").update({ user_id: b.id }).eq("user_id", a.id);
    const { data } = await a.client.from("cvs").select("id");
    expect(data).toHaveLength(1);
  });

  it("B cannot download A's CV file", async () => {
    const { data, error } = await b.client.storage.from("cvs").download(`${a.id}/cv.pdf`);
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("B cannot upload into A's CV folder", async () => {
    const { error } = await b.client.storage
      .from("cvs")
      .upload(`${a.id}/evil.pdf`, pdf(), { contentType: "application/pdf" });
    expect(error).not.toBeNull();
  });

  it("signed-in users can read jobs but not write them", async () => {
    const read = await b.client.from("jobs").select("id").eq("id", jobId);
    expect(read.data).toHaveLength(1);

    const insert = await b.client.from("jobs").insert({
      source: "rls-test",
      external_id: `${run}-b`,
      canonical_url: "https://example.com",
      apply_url: "https://example.com",
      title: "x",
      company_name: "x",
    });
    expect(insert.error).not.toBeNull();

    await b.client.from("jobs").update({ title: "changed" }).eq("id", jobId);
    const after = await admin.from("jobs").select("title").eq("id", jobId).single();
    expect(after.data?.title).toBe("RLS Test Engineer");
  });

  it("anonymous visitors cannot read jobs or personal data", async () => {
    const jobs = await anon.from("jobs").select("id").eq("id", jobId);
    expect(jobs.data ?? []).toEqual([]);
    const cvs = await anon.from("cvs").select("id");
    expect(cvs.data ?? []).toEqual([]);
  });

  it("users cannot read worker run logs", async () => {
    const { data } = await a.client.from("source_runs").select("id");
    expect(data ?? []).toEqual([]);
  });
});
