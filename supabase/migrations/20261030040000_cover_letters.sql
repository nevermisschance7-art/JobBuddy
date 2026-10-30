-- A tailored cover letter per application, made with the CV: its text (also pasted into
-- cover letter text boxes) and PDF and Word files in the cvs bucket next to the CV.
alter table public.applications
  add column if not exists cover_letter_text text check (char_length(cover_letter_text) <= 4000),
  add column if not exists cover_letter_pdf text,
  add column if not exists cover_letter_docx text;
