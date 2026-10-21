"use server";

import { resumeSchema } from "@jobbuddy/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { failed, saved, type ActionState } from "@/lib/action-state";
import { AI_PROVIDERS, validateAiKey, type AiProvider } from "@/lib/ai-keys/validate";
import { encryptSecret } from "@/lib/crypto";
import { cvKind, extractCvText, MAX_CV_BYTES } from "@/lib/cv/extract";
import { readCv } from "@/lib/cv/ai-resume";
import { requireUser } from "@/lib/data";
import { serverEnv } from "@/lib/env";
import { FIXED_ANSWER_KEYS } from "@/lib/fixed-answers";
import { finish, int, list, tags, text } from "@/lib/form";
import { cleanResume } from "@/lib/resume-clean";

// ---------------------------------------------------------------- welcome

export async function startOnboarding(formData: FormData) {
  const { supabase, user } = await requireUser();
  const timeZone = text(formData, "time_zone");
  if (timeZone && isValidTimeZone(timeZone)) {
    await supabase.from("profiles").update({ time_zone: timeZone }).eq("user_id", user.id);
  }
  redirect("/onboarding/ai");
}

function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- CV

export async function uploadCv(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await requireUser();
  const file = formData.get("cv");
  if (!(file instanceof File) || file.size === 0) return failed("Choose a PDF or Word file.");
  if (file.size > MAX_CV_BYTES) return failed("That file is over 5 MB. Try a smaller export.");
  const kind = cvKind(file);
  if (!kind) return failed("Use a PDF or a .docx file.");

  const bytes = new Uint8Array(await file.arrayBuffer());
  let cvText: string;
  try {
    // The PDF reader takes over (detaches) the buffer it gets, so give it a copy.
    cvText = await extractCvText(bytes.slice(), kind);
  } catch (e) {
    console.error("CV extraction failed", e);
    return failed("I couldn't open that file. Is it a normal PDF or .docx?");
  }
  if (cvText.length < 50) {
    return failed("I couldn't find text in that file. If it's a scan, export it as a text PDF.");
  }

  const path = `${user.id}/original-${Date.now()}.${kind}`;
  const upload = await supabase.storage.from("cvs").upload(path, bytes, {
    contentType:
      kind === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  if (upload.error) {
    console.error("CV upload failed", upload.error.message);
    return failed("Saving the file failed. Try again.");
  }

  const read = await readCv(supabase, user.id, cvText);

  const { error } = await supabase.from("cvs").insert({
    user_id: user.id,
    original_file: path,
    resume_json: read.resume,
    confirmed: false,
  });
  if (error) return failed("Saving your CV failed. Try again.");

  revalidatePath("/", "layout");
  return saved(read.note ?? "Got it. Check what I read below and fix anything that's off.");
}

export async function confirmResume(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await requireUser();
  const cvId = text(formData, "cv_id");
  const raw = text(formData, "resume_json");
  if (!cvId || !raw) return failed("Something went wrong. Reload the page and try again.");

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return failed("Something went wrong. Reload the page and try again.");
  }
  const parsed = resumeSchema.safeParse(cleanResume(json));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return failed(`Check ${issue?.path.join(" › ") ?? "the form"}: ${issue?.message ?? "invalid"}`);
  }

  const { error } = await supabase
    .from("cvs")
    .update({ resume_json: parsed.data, confirmed: true })
    .eq("id", cvId)
    .eq("user_id", user.id);
  if (error) return failed("Saving failed. Try again.");

  revalidatePath("/", "layout");
  return finish(formData, saved("CV confirmed. This is now the only source I tailor from."));
}

// ---------------------------------------------------------------- filters

const filtersSchema = z.object({
  countries_allowed: z.array(z.string().regex(/^[A-Z]{2}$/)),
  needs_sponsorship: z.boolean(),
  remote_types: z
    .array(z.enum(["remote", "hybrid", "onsite"]))
    .min(1, "Pick at least one work style."),
  hybrid_max_office_days: z.number().int().min(0).max(5).nullable(),
  home_location: z.string().max(200).nullable(),
  max_commute_km: z.number().int().min(0).max(500).nullable(),
  seniority_levels: z.array(z.enum(["junior", "mid", "senior", "lead", "principal"])),
  must_have_skills: z.array(z.string().max(60)).max(50),
  excluded_skills: z.array(z.string().max(60)).max(50),
  excluded_companies: z.array(z.string().max(100)).max(200),
  salary_floor: z.number().int().min(0).nullable(),
  salary_currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  employment_types: z
    .array(z.enum(["full_time", "part_time", "contract", "temporary"]))
    .min(1, "Pick at least one job type."),
});

export async function saveFilters(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await requireUser();
  const parsed = filtersSchema.safeParse({
    countries_allowed: tags(formData, "countries_allowed"),
    needs_sponsorship: formData.get("needs_sponsorship") === "on",
    remote_types: list(formData, "remote_types"),
    hybrid_max_office_days: int(formData, "hybrid_max_office_days"),
    home_location: text(formData, "home_location"),
    max_commute_km: int(formData, "max_commute_km"),
    seniority_levels: list(formData, "seniority_levels"),
    must_have_skills: tags(formData, "must_have_skills"),
    excluded_skills: tags(formData, "excluded_skills"),
    excluded_companies: tags(formData, "excluded_companies"),
    salary_floor: int(formData, "salary_floor"),
    salary_currency: text(formData, "salary_currency"),
    employment_types: list(formData, "employment_types"),
  });
  if (!parsed.success) return failed(parsed.error.issues[0]?.message ?? "Check the form.");
  if (parsed.data.countries_allowed.length === 0) {
    return failed("Add at least one country you can work in.");
  }

  const minScore = int(formData, "min_score");
  if (minScore === null || minScore < 0 || minScore > 100)
    return failed("Pick a score from 0 to 100.");

  const [f, p] = await Promise.all([
    supabase.from("filters").update(parsed.data).eq("user_id", user.id),
    supabase.from("profiles").update({ min_score: minScore }).eq("user_id", user.id),
  ]);
  if (f.error || p.error) return failed("Saving failed. Try again.");

  revalidatePath("/", "layout");
  return finish(formData, saved());
}

// ---------------------------------------------------------------- fixed answers

export async function saveFixedAnswers(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user } = await requireUser();

  const filled = FIXED_ANSWER_KEYS.map(({ key }) => ({ key, value: text(formData, key) }));
  const toSave = filled.filter((a): a is { key: string; value: string } => a.value !== null);
  const toClear = filled.filter((a) => a.value === null).map((a) => a.key);

  if (toSave.length > 0) {
    const { error } = await supabase.from("fixed_answers").upsert(
      toSave.map((a) => ({
        user_id: user.id,
        key: a.key,
        value: a.value.slice(0, 500),
        applies_to_country: null,
      })),
      { onConflict: "user_id,key,applies_to_country" },
    );
    if (error) return failed("Saving failed. Try again.");
  }
  if (toClear.length > 0) {
    await supabase
      .from("fixed_answers")
      .delete()
      .eq("user_id", user.id)
      .is("applies_to_country", null)
      .in("key", toClear);
  }

  revalidatePath("/", "layout");
  return finish(formData, saved());
}

// ---------------------------------------------------------------- AI keys

export async function saveAiKey(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await requireUser();
  const provider = text(formData, "provider") as AiProvider | null;
  const key = text(formData, "key");
  if (!provider || !AI_PROVIDERS.includes(provider)) return failed("Unknown provider.");
  if (!key) return failed("Paste your key first.");
  if (key.length > 300) return failed("That doesn't look like an API key.");

  const problem = await validateAiKey(provider, key);
  if (problem) return failed(problem);

  const { error } = await supabase.from("ai_keys").upsert(
    {
      user_id: user.id,
      provider,
      encrypted_key: encryptSecret(key, serverEnv("APP_ENCRYPTION_KEY")),
      last_error: null,
      quota_reset_at: null,
    },
    { onConflict: "user_id,provider" },
  );
  if (error) return failed("Saving failed. Try again.");

  revalidatePath("/", "layout");
  return saved("Key works and is saved, encrypted.");
}

export async function removeAiKey(formData: FormData) {
  const { supabase, user } = await requireUser();
  const provider = text(formData, "provider");
  if (provider) {
    await supabase.from("ai_keys").delete().eq("user_id", user.id).eq("provider", provider);
  }
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------- tone and finish

export async function saveTone(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await requireUser();
  const tone = text(formData, "tone");
  if (tone !== "kind" && tone !== "funny" && tone !== "plain") return failed("Pick a tone.");
  const { error } = await supabase.from("profiles").update({ tone }).eq("user_id", user.id);
  if (error) return failed("Saving failed. Try again.");
  revalidatePath("/", "layout");
  return finish(formData, saved());
}

export async function finishOnboarding() {
  const { supabase, user } = await requireUser();
  await supabase
    .from("profiles")
    .update({ onboarded_at: new Date().toISOString() })
    .eq("user_id", user.id);
  redirect("/app");
}
