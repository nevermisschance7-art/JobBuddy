import { createClient } from "@supabase/supabase-js";

// Runs once after all browser tests, even when a test timed out: deletes every test account
// (usernames starting "e2e-") and its files, so test runs never leave data behind.
export default async function teardown() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data } = await db.auth.admin.listUsers({ perPage: 1000 });
  for (const user of data?.users ?? []) {
    const username = (user.user_metadata as { username?: string } | null)?.username ?? "";
    if (!username.startsWith("e2e-")) continue;
    const { data: files } = await db.storage.from("cvs").list(user.id);
    if (files?.length) {
      await db.storage.from("cvs").remove(files.map((f) => `${user.id}/${f.name}`));
    }
    const { error } = await db.auth.admin.deleteUser(user.id);
    console.log(error ? `could not delete ${username}: ${error.message}` : `deleted ${username}`);
  }
}
