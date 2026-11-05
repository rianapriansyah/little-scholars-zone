-- The staff table stops being "teachers" and becomes "employees", because not everyone the school
-- employs teaches: a Pengasuh, a Kasir and an Admin are staff too, and need a row to log in and be
-- assigned work from. Three changes ride together because they all reshape the same table:
--
--   1. employee_positions — a new lookup (Pengajar, Pengasuh, Kasir, Admin), referenced by
--      employees.position_id.
--   2. teachers → employees, with the table's own constraints, index and policies renamed to match.
--   3. teachers.rate is dropped. It was superseded by classrooms.teacher_rate (a teacher is paid
--      the rate of the class she teaches, not a personal one) and nothing reads it any more.
--
-- What deliberately keeps its name: the teacher_id columns (classroom_teachers.teacher_id,
-- classroom_teachers_substitutions.substitute_teacher_id), the classroom_teachers table, the
-- 'teacher' auth role and the teacher_* helper functions. Those describe the *teaching* role and
-- relationship — the employee assigned to a class is that class's teacher — not this table.
--
-- APPLY TOGETHER WITH THE APP AND EDGE FUNCTION DEPLOY. The renamed table is a breaking change for
-- any client still querying `teachers` (the deployed frontend, and create-teacher-account until it
-- is redeployed), so this must not land on production ahead of the code that reads `employees`.

-- ---------------------------------------------------------------------------
-- 1. Positions.
-- ---------------------------------------------------------------------------

CREATE TABLE public.employee_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT employee_positions_position_key UNIQUE (position)
);

COMMENT ON TABLE public.employee_positions IS
  'What an employee is employed as — Pengajar, Pengasuh, Kasir, Admin. Referenced by '
  'employees.position_id. A job title only: it grants nothing. Access is still decided by the '
  'auth role in app_metadata, so changing someone''s position never changes what they can open.';

INSERT INTO public.employee_positions (position) VALUES
  ('Pengajar'),
  ('Pengasuh'),
  ('Kasir'),
  ('Admin');

GRANT ALL ON public.employee_positions TO authenticated, service_role;
ALTER TABLE public.employee_positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_all_employee_positions ON public.employee_positions FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- The list itself is not sensitive — four job titles — and any signed-in staff screen that shows a
-- position needs to resolve the name.
CREATE POLICY authenticated_select_employee_positions ON public.employee_positions FOR SELECT
  TO authenticated
  USING (true);

-- ---------------------------------------------------------------------------
-- 2. teachers → employees.
--
-- ALTER TABLE ... RENAME moves everything bound to the table by OID: the foreign keys pointing at
-- it (classroom_teachers.teacher_id, classroom_teachers_substitutions.substitute_teacher_id), its
-- RLS policies, its grants, and every view and policy elsewhere that reads it — those store a
-- parsed reference, not text. Same mechanism 20260930010000_children_daily_reports.sql relied on.
--
-- What it does NOT move is a function body: plpgsql and plain-SQL function bodies are stored as
-- text and re-resolved at call time, so every function that says `public.teachers` would start
-- failing the moment this runs. Part 5 rewrites them.
-- ---------------------------------------------------------------------------

ALTER TABLE public.teachers RENAME TO employees;

-- The names generated when the table was created still say "teachers". Renaming a PRIMARY KEY or
-- UNIQUE constraint renames its index with it.
ALTER TABLE public.employees RENAME CONSTRAINT teachers_pkey TO employees_pkey;
ALTER TABLE public.employees RENAME CONSTRAINT teachers_email_key TO employees_email_key;
ALTER TABLE public.employees RENAME CONSTRAINT teachers_auth_user_id_fkey TO employees_auth_user_id_fkey;
ALTER INDEX public.teachers_auth_user_id_idx RENAME TO employees_auth_user_id_idx;

ALTER POLICY admin_all_teachers ON public.employees RENAME TO admin_all_employees;
ALTER POLICY teacher_select_own_profile ON public.employees RENAME TO employee_select_own_profile;

COMMENT ON TABLE public.employees IS
  'Everyone the school employs — teaching and non-teaching staff alike, told apart by '
  'position_id. Formerly `teachers`. A row is linked to its login through auth_user_id. Being '
  'assigned to a class (classroom_teachers.teacher_id) is what makes an employee that class''s '
  'teacher, independent of their position.';

-- ---------------------------------------------------------------------------
-- 3. Drop the personal rate. Takes its CHECK (teachers_rate_non_negative) with it.
-- ---------------------------------------------------------------------------

ALTER TABLE public.employees DROP COLUMN rate;

-- ---------------------------------------------------------------------------
-- 4. employees.position_id.
--
-- NOT NULL with a default of Pengajar rather than nullable. Every row that exists today was created
-- as a teacher, and both paths that create one — the create-teacher-account edge function and the
-- admin Guru dialog — still only ever create teachers. A default states that once, in the schema,
-- instead of in each insert path; when a position picker arrives it simply passes a value.
--
-- A function rather than a literal because the id is a generated uuid that differs per database.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.default_employee_position_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT id FROM public.employee_positions WHERE position = 'Pengajar'
$$;

COMMENT ON FUNCTION public.default_employee_position_id() IS
  'The Pengajar position''s id — the default for employees.position_id, since every insert path '
  'today creates a teacher.';

-- Adding a column whose default is not a constant evaluates it for every existing row, which is
-- exactly the backfill wanted: every current employee becomes a Pengajar.
ALTER TABLE public.employees
  ADD COLUMN position_id uuid NOT NULL
    DEFAULT public.default_employee_position_id()
    CONSTRAINT employees_position_id_fkey REFERENCES public.employee_positions(id);

CREATE INDEX employees_position_id_idx ON public.employees (position_id);

-- ---------------------------------------------------------------------------
-- 5. Re-point every function body at public.employees.
--
-- Done by rewriting each function's own current definition rather than by pasting nineteen
-- functions here by hand. A hand copy would have to reproduce each one exactly as it stands today —
-- several have been redefined across a dozen migrations — and any drift would silently revert a
-- later fix. pg_get_functiondef returns the complete live CREATE OR REPLACE statement (security,
-- search_path, volatility included); CREATE OR REPLACE keeps the function's grants and comment.
--
-- Safe as a textual replace because every live body refers to the table as the qualified
-- `public.teachers` — checked before writing this — and \M stops it matching a longer name such as
-- `public.teachers_x`. The only bare "teachers" left in any body is prose in a comment.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  r record;
  v_rewritten int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosrc ~ 'public\.teachers\M'
  LOOP
    EXECUTE regexp_replace(pg_get_functiondef(r.oid), 'public\.teachers\M', 'public.employees', 'g');
    v_rewritten := v_rewritten + 1;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosrc ~ 'public\.teachers\M'
  ) THEN
    RAISE EXCEPTION 'Some function still references public.teachers after the rewrite';
  END IF;

  RAISE NOTICE 'Re-pointed % function(s) at public.employees', v_rewritten;
END;
$$;
