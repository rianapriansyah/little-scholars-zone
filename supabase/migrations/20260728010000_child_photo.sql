-- Children get a profile photo, same pattern as teachers.photo_url.
ALTER TABLE public.children ADD COLUMN photo_url text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('child-photos', 'child-photos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY admin_write_child_photos ON storage.objects FOR ALL
  USING (bucket_id = 'child-photos' AND (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK (bucket_id = 'child-photos' AND (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
