-- Teacher profile: last education (level, school, graduation year — collapsed into one
-- "education" text column, composed/parsed on the client as "{level} | {school} | {year}"),
-- a profile photo, and employment start/end dates. end_working_at stays null while the
-- teacher is currently employed.

ALTER TABLE public.teachers ADD COLUMN education text;
ALTER TABLE public.teachers ADD COLUMN photo_url text;
ALTER TABLE public.teachers ADD COLUMN start_working_at date NOT NULL DEFAULT current_date;
ALTER TABLE public.teachers ADD COLUMN end_working_at date;

-- Storage bucket for teacher profile photos. Public bucket so getPublicUrl() works without
-- signed URLs; writes are restricted to admins.
INSERT INTO storage.buckets (id, name, public)
VALUES ('teacher-photos', 'teacher-photos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY admin_write_teacher_photos ON storage.objects FOR ALL
  USING (bucket_id = 'teacher-photos' AND (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK (bucket_id = 'teacher-photos' AND (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
