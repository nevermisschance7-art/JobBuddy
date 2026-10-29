import { resumeSchema } from "@jobbuddy/shared";
import { LlmRouter, type ProviderKey } from "@jobbuddy/shared/llm";
import { expect, it } from "vitest";
import { extractCvText } from "@/lib/cv/extract";
import { readCvWithRouter } from "@/lib/cv/read-core";

// Manual "Re-read CV" workflow: reads one user's uploaded CV file again with the website's
// CV reader (real model) and saves it as their confirmed CV. Clearing the embedding makes
// the matcher rescore every job for them. Never part of `pnpm test`.

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const username = process.env.REREAD_USERNAME!;
const h = { apikey: key, authorization: `Bearer ${key}` };

const keys: ProviderKey[] = [
  ["gemini", process.env.GEMINI_API_KEY],
  ["groq", process.env.GROQ_API_KEY],
  ["openrouter", process.env.OPENROUTER_API_KEY],
]
  .filter(([, k]) => k)
  .map(([provider, apiKey]) => ({ provider, apiKey, coolingUntil: null }) as ProviderKey);

const router = new LlmRouter({
  keys: { getKeys: async () => keys, markCoolingDown: async () => {}, markBroken: async () => {} },
  sinks: { logCall: async () => {}, needsFixing: async () => {} },
});

it.skipIf(!username)(
  `re-reads the CV of ${username}`,
  async () => {
    const profile = (
      await (
        await fetch(`${url}/rest/v1/profiles?username=eq.${username}&select=user_id`, {
          headers: h,
        })
      ).json()
    )[0];
    expect(profile, "no such user").toBeTruthy();
    const cv = (
      await (
        await fetch(
          `${url}/rest/v1/cvs?user_id=eq.${profile.user_id}&original_file=not.is.null&select=id,original_file,resume_json&order=created_at.desc&limit=1`,
          { headers: h },
        )
      ).json()
    )[0];
    expect(cv?.original_file, "no uploaded CV").toBeTruthy();

    const file = await fetch(`${url}/storage/v1/object/cvs/${cv.original_file}`, { headers: h });
    expect(file.ok).toBe(true);
    const kind = cv.original_file.endsWith(".docx") ? "docx" : "pdf";
    const text = await extractCvText(new Uint8Array(await file.arrayBuffer()), kind);

    const before = resumeSchema.safeParse(cv.resume_json);
    const basics = before.success ? before.data.basics : undefined;
    const resume = await readCvWithRouter(router, profile.user_id, text, {
      name: basics?.name,
      email: basics?.email,
      phone: basics?.phone,
    });
    const skills = resume.skills.flatMap((s) => s.keywords);
    console.log(`Read: ${resume.work.length} jobs, ${skills.length} skills: ${skills.join(", ")}`);
    expect(skills.length).toBeGreaterThan(0);

    const save = await fetch(`${url}/rest/v1/cvs?id=eq.${cv.id}`, {
      method: "PATCH",
      headers: { ...h, "content-type": "application/json" },
      body: JSON.stringify({ resume_json: resume, confirmed: true, embedding: null }),
    });
    expect(save.ok).toBe(true);
    console.log("Saved. The next matcher run rescores every job for this user.");
  },
  120_000,
);
