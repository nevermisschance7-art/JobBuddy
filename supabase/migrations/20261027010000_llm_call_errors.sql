-- The provider's error text for failed calls, to diagnose problems.
-- Never prompt or response content.
alter table public.llm_calls add column error_message text check (char_length(error_message) <= 300);
