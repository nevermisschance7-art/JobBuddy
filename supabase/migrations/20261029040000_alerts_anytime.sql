-- Alerts come at any time of day: no quiet hours (the owner's choice).
alter table public.profiles
  alter column alert_settings set default jsonb_build_object(
    'enabled_types', jsonb_build_array('daily_summary', 'hot_match', 'application_ready', 'weekly_nudge', 'needs_fixing'),
    'daily_summary_time', '09:00',
    'humour', true
  );

update public.profiles set alert_settings = alert_settings - 'quiet_hours'
where alert_settings ? 'quiet_hours';
