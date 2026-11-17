-- Every view in public must be security_invoker, so the RLS of the tables it reads applies to the
-- caller. A view without it runs with its owner's rights and bypasses RLS: that is how
-- employee_attendance_status leaked teachers' clock-ins to parents between 20261116040000 and
-- 20261118030000 (CREATE OR REPLACE VIEW without a WITH clause drops the option).
--
-- Also checks the effect, not just the flag: a parent sees no employee clock-ins through the
-- status view, and a teacher sees exactly the clock-ins the table's RLS gives her.
--
-- Run (read-only in effect, ends in ROLLBACK):
--   npx supabase db query --linked --yes -f supabase/tests/views_security_invoker.test.sql

BEGIN;

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO missing
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'v'
     AND NOT coalesce(c.reloptions::text ~ 'security_invoker=(true|on)', false);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: views without security_invoker: %', missing;
  END IF;
  RAISE NOTICE 'PASS: every public view is security_invoker';
END $$;

CREATE TEMP TABLE who AS
  SELECT
    (SELECT f.auth_user_id FROM public.families f
       JOIN public.children ch ON ch.family_id = f.id
       JOIN public.children_classrooms cc ON cc.child_id = ch.id
      WHERE f.auth_user_id IS NOT NULL LIMIT 1) AS parent_uid,
    (SELECT e.auth_user_id FROM public.employees e
       JOIN public.employee_assignments ea ON ea.teacher_id = e.id
       JOIN public.employee_attendances a ON a.classroom_teacher_id = ea.id
      WHERE e.auth_user_id IS NOT NULL
      GROUP BY e.auth_user_id ORDER BY count(*) DESC LIMIT 1) AS teacher_uid;
CREATE TEMP TABLE seen (who text, via_view bigint, via_table bigint);
GRANT SELECT ON who TO authenticated;
GRANT INSERT ON seen TO authenticated;

SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT parent_uid FROM who), 'role', 'authenticated')::text, true);
SET LOCAL role authenticated;
INSERT INTO seen SELECT 'parent',
  (SELECT count(*) FROM public.employee_attendance_status),
  (SELECT count(*) FROM public.employee_attendances);
RESET role;

SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT teacher_uid FROM who), 'role', 'authenticated')::text, true);
SET LOCAL role authenticated;
INSERT INTO seen SELECT 'teacher',
  (SELECT count(*) FROM public.employee_attendance_status),
  (SELECT count(*) FROM public.employee_attendances);
RESET role;

DO $$
DECLARE
  r record;
BEGIN
  IF (SELECT parent_uid FROM who) IS NULL OR (SELECT teacher_uid FROM who) IS NULL THEN
    RAISE EXCEPTION 'FAIL: no parent or teacher with a login to test with';
  END IF;
  FOR r IN SELECT * FROM seen LOOP
    IF r.via_view <> r.via_table THEN
      RAISE EXCEPTION 'FAIL: % sees % clock-ins through the status view but % in the table', r.who, r.via_view, r.via_table;
    END IF;
  END LOOP;
  IF (SELECT via_view FROM seen WHERE who = 'parent') <> 0 THEN
    RAISE EXCEPTION 'FAIL: a parent can read employee clock-ins';
  END IF;
  IF (SELECT via_view FROM seen WHERE who = 'teacher') = 0 THEN
    RAISE EXCEPTION 'FAIL: the teacher cannot read her own clock-ins';
  END IF;
  RAISE NOTICE 'PASS: status view rows match the attendance RLS for a parent and a teacher';
END $$;

ROLLBACK;
