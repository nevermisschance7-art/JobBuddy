-- CV tailoring per application.
-- tailor_report: what the truth checker removed or corrected, and the job's requirements the
-- CV doesn't show ("gaps", shown to the user, never added to the CV).
alter table public.applications
  add column tailor_report jsonb,
  add column tailored_at timestamptz,
  add column cv_approved_at timestamptz;
