-- office_branch: the school's offices (cabang), managed by the admin from Kelola Cabang.
--
-- Deliberately just id + name for now. Nothing references it yet; the other properties (and the
-- links from classrooms, teachers, etc.) come in later migrations.
--
-- Name is unique ignoring case and surrounding spaces, so "Cabang Utama" and " cabang utama" cannot
-- both exist — the admin would have no way to tell them apart in a picker.
--
-- RLS: admin only, read and write. No other role has a screen that reads branches yet; a SELECT
-- policy for teachers/parents can be added when one does.
--
-- Grants: revoke first, then SELECT/INSERT/UPDATE/DELETE for authenticated and service_role only.
-- Supabase's default privileges would otherwise hand anon everything on a new table (the same
-- issue 20261113030000 fixed on learning_period_status).

CREATE TABLE public.office_branch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (btrim(name) <> '')
);

CREATE UNIQUE INDEX office_branch_name_key ON public.office_branch (lower(btrim(name)));

COMMENT ON TABLE public.office_branch IS
  'School offices (cabang), managed from Kelola Cabang. id + name only for now; more columns later.';

REVOKE ALL ON public.office_branch FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.office_branch TO authenticated, service_role;

ALTER TABLE public.office_branch ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_all_office_branch ON public.office_branch FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
