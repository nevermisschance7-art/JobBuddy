-- New alert type: good news from an employer (interview, test, offer, next step), found in
-- Gmail by the user's mail script. On by default, for new and existing users.
alter table public.profiles
  alter column alert_settings set default jsonb_build_object(
    'enabled_types', jsonb_build_array(
      'daily_summary', 'hot_match', 'application_ready', 'weekly_nudge', 'needs_fixing', 'good_news'
    ),
    'daily_summary_time', '09:00',
    'humour', true
  );

update public.profiles
set alert_settings = jsonb_set(
  alert_settings,
  '{enabled_types}',
  (alert_settings -> 'enabled_types') || '["good_news"]'::jsonb
)
where jsonb_typeof(alert_settings -> 'enabled_types') = 'array'
  and not (alert_settings -> 'enabled_types') ? 'good_news';
