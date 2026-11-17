-- Rollback for 20261118020000_drop_old_names_teacher_rate_staff_classrooms.sql: the 9 staff
-- classrooms and classrooms.teacher_rate (with its values and comment) come back from
-- backup.*_20261118, and the old-name pass-through views are recreated. Classrooms created after
-- the migration get a NULL teacher_rate, which nothing reads.
--
-- Run: npx supabase db query --linked --yes -f supabase/rollbacks/20261118020000_drop_old_names_teacher_rate_staff_classrooms.sql

BEGIN;

ALTER TABLE public.classrooms ADD COLUMN teacher_rate numeric;
COMMENT ON COLUMN public.classrooms.teacher_rate IS 'What a teacher earns per hour for teaching this class, in IDR. NULL means not set yet: the class''s logged minutes earn nothing and the monthly estimate names it as missing a rate, rather than counting it as zero. Distinct from classrooms.price, which is what the family is charged. Applies to internal programs too (Piket Pagi, Pembuatan Konten) — they are not billed to families but are paid work, so they carry a rate like any other class.';

-- The 9 staff classrooms, by column name (teacher_rate is now last in the live table).
DO $$
DECLARE
  cols text;
BEGIN
  SELECT string_agg(format('%I', b.column_name), ', ' ORDER BY b.ordinal_position) INTO cols
    FROM information_schema.columns b
   WHERE b.table_schema = 'backup' AND b.table_name = 'staff_classrooms_20261118';
  EXECUTE format('INSERT INTO public.classrooms (%s) SELECT %s FROM backup.staff_classrooms_20261118', cols, cols);
END $$;

UPDATE public.classrooms c SET teacher_rate = b.teacher_rate
  FROM backup.classrooms_teacher_rate_20261118 b WHERE b.id = c.id;

CREATE VIEW public.classroom_teachers WITH (security_invoker = true) AS
  SELECT * FROM public.employee_assignments;
CREATE VIEW public.classroom_teachers_attendances WITH (security_invoker = true) AS
  SELECT * FROM public.employee_attendances;
CREATE VIEW public.classroom_teacher_work_sessions WITH (security_invoker = true) AS
  SELECT * FROM public.employee_work_sessions;
CREATE VIEW public.classroom_teachers_substitutions WITH (security_invoker = true) AS
  SELECT * FROM public.employee_substitutions;
CREATE VIEW public.classroom_teachers_attendance_status WITH (security_invoker = true) AS
  SELECT * FROM public.employee_attendance_status;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.classroom_teachers, public.classroom_teachers_attendances,
  public.classroom_teacher_work_sessions, public.classroom_teachers_substitutions
  TO authenticated, service_role;
GRANT SELECT ON public.classroom_teachers_attendance_status TO authenticated, service_role;

DROP TABLE backup.staff_classrooms_20261118;
DROP TABLE backup.classrooms_teacher_rate_20261118;

NOTIFY pgrst, 'reload schema';

COMMIT;
