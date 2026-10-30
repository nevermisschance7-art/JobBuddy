-- Several keys per provider (up to 5, checked by the app), and two more free providers.
alter table public.ai_keys drop constraint if exists ai_keys_user_id_provider_key;
alter table public.ai_keys drop constraint if exists ai_keys_provider_check;
alter table public.ai_keys
  add constraint ai_keys_provider_check
  check (provider in ('gemini', 'groq', 'cerebras', 'mistral', 'openrouter'));
-- The key's last 4 characters, so the owner can tell their keys apart. Never the key.
alter table public.ai_keys add column if not exists key_hint text check (char_length(key_hint) <= 8);
create index if not exists ai_keys_user_provider on public.ai_keys (user_id, provider);
