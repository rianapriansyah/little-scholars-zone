-- Tests for staff work with no classroom: an assignment to a work item (Kasir, Konten...) with its
-- own times, which is what every staff assignment becomes in Phase 3c of the employee work
-- refactor (migrations 20261116020000, 20261116040000, 20261116050000).
--
-- Covers: the admin can assign someone to a work item with no class, a teacher cannot; an
-- assignment must point at a class or a work item; the assignment's own schedule drives clock-in,
-- clock-out and the status view; flexi staff work banks its sessions; the rate and branch come from
-- the work item.
--
-- Everything runs inside one transaction that ends in ROLLBACK, so it is safe to run against the
-- live project: no fixture survives the script. It creates its own auth.users rows and
-- impersonates them with `SET LOCAL ROLE authenticated` + `request.jwt.claims`.
--
-- Run with:  npx supabase db query --linked --yes -f supabase/tests/work_item_assignments.test.sql
--
-- Every assertion RAISEs on failure. A clean run ends with 'ALL WORK ITEM ASSIGNMENT TESTS PASSED'.
--
-- The RPCs read today's WITA date and now() themselves, so the scheduled assignment below starts at
-- 00:00 and ends 3 minutes from now: the clock-in window is open and the clock-out floor (end minus
-- 5 minutes) already reached, whatever time the suite runs (except in the last few minutes before
-- midnight, when the end time would wrap).

BEGIN;

-- ---------------------------------------------------------------------------
-- Fixtures: an admin, one staff member, two work items in the Rucil branch.
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_app_meta_data, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-c000-000000000001', 'authenticated', 'authenticated', 'wi-test-admin@example.test', '{"role":"admin"}',   now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-c000-000000000002', 'authenticated', 'authenticated', 'wi-test-staff@example.test', '{"role":"teacher"}', now(), now());

INSERT INTO public.employees (id, full_name, call_name, email, auth_user_id) VALUES
  ('00000000-0000-4000-c000-000000000010', 'Work Item Test Staff', 'Bu W', 'wi-test-staff@example.test', '00000000-0000-4000-c000-000000000002');

INSERT INTO public.work_items (id, branch_id, name, hourly_rate) VALUES
  ('00000000-0000-4000-c000-000000000030', (SELECT id FROM public.office_branch WHERE name = 'Rumah Main Rumah Kecil (Rucil)'), 'WI Test Kasir',  9000),
  ('00000000-0000-4000-c000-000000000031', (SELECT id FROM public.office_branch WHERE name = 'Rumah Main Rumah Kecil (Rucil)'), 'WI Test Konten', 7000);

CREATE OR REPLACE FUNCTION pg_temp.status(p_group uuid)
RETURNS public.classroom_teachers_attendance_status LANGUAGE sql STABLE AS $fn$
  SELECT * FROM public.classroom_teachers_attendance_status
   WHERE classroom_teacher_id = p_group
     AND session_date = (now() AT TIME ZONE 'Asia/Makassar')::date;
$fn$;

-- now() is frozen inside a transaction; pushes the running flexi session back to give it length.
-- SECURITY DEFINER for the same reason as in flexi_work_sessions.test.sql: fixture manipulation,
-- not behaviour under test.
CREATE OR REPLACE FUNCTION pg_temp.backdate_open_session(p_group uuid, p_interval interval)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_attendance_id uuid := (SELECT id FROM public.classroom_teachers_attendances
    WHERE classroom_teacher_id = p_group AND session_date = (now() AT TIME ZONE 'Asia/Makassar')::date);
BEGIN
  PERFORM set_config('app.work_sessions_managed', 'on', true);
  UPDATE public.classroom_teacher_work_sessions SET started_at = started_at - p_interval
    WHERE attendance_id = v_attendance_id AND ended_at IS NULL;
  UPDATE public.classroom_teachers_attendances SET clocked_in_at = (
      SELECT min(started_at) FROM public.classroom_teacher_work_sessions WHERE attendance_id = v_attendance_id)
    WHERE id = v_attendance_id;
  PERFORM set_config('app.work_sessions_managed', '', true);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- The admin assigns staff work with no classroom.
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-c000-000000000001","role":"authenticated","app_metadata":{"role":"admin"}}';

INSERT INTO public.classroom_teachers (id, teacher_id, classroom_id, work_item_id, time_start, time_end, is_flexi_hours) VALUES
  ('00000000-0000-4000-c000-000000000020', '00000000-0000-4000-c000-000000000010', NULL, '00000000-0000-4000-c000-000000000030',
   '00:00', ((now() AT TIME ZONE 'Asia/Makassar') + interval '3 minutes')::time, false),
  ('00000000-0000-4000-c000-000000000021', '00000000-0000-4000-c000-000000000010', NULL, '00000000-0000-4000-c000-000000000031',
   '08:00', '17:00', true);

DO $$
BEGIN
  IF (SELECT count(*) FROM public.employee_assignment_schedules
       WHERE employee_id = '00000000-0000-4000-c000-000000000010' AND classroom_id IS NULL) <> 2 THEN
    RAISE EXCEPTION 'FAIL: both classroom-less assignments must have a schedule';
  END IF;
  RAISE NOTICE 'PASS: the admin assigns staff work with no classroom';

  BEGIN
    INSERT INTO public.classroom_teachers (teacher_id, classroom_id, work_item_id)
    VALUES ('00000000-0000-4000-c000-000000000010', NULL, NULL);
    RAISE EXCEPTION 'FAIL: an assignment with neither a class nor a work item was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: an assignment needs a class or a work item';
  END;

  BEGIN
    INSERT INTO public.classroom_teachers (teacher_id, work_item_id, time_start, time_end)
    VALUES ('00000000-0000-4000-c000-000000000010', '00000000-0000-4000-c000-000000000030', '08:00', '09:00');
    RAISE EXCEPTION 'FAIL: a work-item assignment without its flexi flag was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: a work-item assignment states whether it is flexi';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- The staff member: sees only their own, cannot assign, clocks in and out.
-- ---------------------------------------------------------------------------

SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-c000-000000000002","role":"authenticated","app_metadata":{"role":"teacher"}}';

DO $$
DECLARE
  v_kasir uuid := '00000000-0000-4000-c000-000000000020';
  v_konten uuid := '00000000-0000-4000-c000-000000000021';
  v_label text;
  v_status public.classroom_teachers_attendance_status;
  v_end time;
BEGIN
  SELECT label INTO v_label FROM public.employee_assignment_schedules WHERE classroom_teacher_id = v_kasir;
  IF v_label <> 'WI Test Kasir — Rumah Main Rumah Kecil (Rucil)' THEN
    RAISE EXCEPTION 'FAIL: the staff member must see their work item labelled with its branch, got %', v_label;
  END IF;
  RAISE NOTICE 'PASS: the staff member sees their own staff work, labelled with its branch';

  BEGIN
    INSERT INTO public.classroom_teachers (teacher_id, work_item_id, time_start, time_end, is_flexi_hours)
    VALUES ('00000000-0000-4000-c000-000000000010', '00000000-0000-4000-c000-000000000030', '08:00', '09:00', false);
    RAISE EXCEPTION 'FAIL: a teacher was able to assign themselves';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: a teacher cannot assign staff work';
  END;

  -- Scheduled staff work: the clock-in and clock-out rules use the assignment's own times.
  PERFORM public.clock_in_classroom_teacher(v_kasir);
  PERFORM public.clock_out_classroom_teacher(v_kasir);
  v_status := pg_temp.status(v_kasir);
  SELECT time_end INTO v_end FROM public.employee_assignment_schedules WHERE classroom_teacher_id = v_kasir;

  IF v_status.id IS NULL THEN
    RAISE EXCEPTION 'FAIL: clocking in and out of classroom-less staff work must leave a status row';
  END IF;
  IF (v_status.scheduled_end AT TIME ZONE 'Asia/Makassar')::time <> v_end THEN
    RAISE EXCEPTION 'FAIL: the scheduled end must be the assignment''s own end (%), got %',
      v_end, v_status.scheduled_end;
  END IF;
  IF (v_status.scheduled_start AT TIME ZONE 'Asia/Makassar')::time <> '00:00' THEN
    RAISE EXCEPTION 'FAIL: the scheduled start must be the assignment''s own start';
  END IF;
  IF v_status.departure_status <> 'on_time' OR v_status.minutes_taught IS NULL OR v_status.minutes_taught < 0 THEN
    RAISE EXCEPTION 'FAIL: clock-out at the own scheduled end must be on time with minutes, got % / %',
      v_status.departure_status, v_status.minutes_taught;
  END IF;
  RAISE NOTICE 'PASS: scheduled staff work clocks in and out against its own times (% min, %)',
    v_status.minutes_taught, v_status.departure_status;

  -- Flexi staff work: sessions, no late/early status.
  PERFORM public.clock_in_classroom_teacher(v_konten);
  PERFORM pg_temp.backdate_open_session(v_konten, interval '45 minutes');
  PERFORM public.clock_out_classroom_teacher(v_konten);
  v_status := pg_temp.status(v_konten);

  IF v_status.minutes_taught <> 45 OR v_status.work_session_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: a 45-minute flexi session must bank 45 minutes in 1 session, got % in %',
      v_status.minutes_taught, v_status.work_session_count;
  END IF;
  IF v_status.arrival_status <> 'not_applicable' OR v_status.departure_status <> 'not_applicable' THEN
    RAISE EXCEPTION 'FAIL: flexi staff work has no late or early status';
  END IF;
  RAISE NOTICE 'PASS: flexi staff work banks its session (45 min) with no late/early status';
END $$;

-- ---------------------------------------------------------------------------
-- Pay: the work item's rate and branch.
-- ---------------------------------------------------------------------------

RESET ROLE;
SET LOCAL request.jwt.claims = '';

DO $$
DECLARE
  v_rate numeric;
  v_branch text;
BEGIN
  SELECT hourly_rate, branch_name INTO v_rate, v_branch
    FROM public.employee_assignment_rates WHERE classroom_teacher_id = '00000000-0000-4000-c000-000000000020';
  IF v_rate <> 9000 OR v_branch <> 'Rumah Main Rumah Kecil (Rucil)' THEN
    RAISE EXCEPTION 'FAIL: staff work must be paid its work item''s rate and branch, got % / %', v_rate, v_branch;
  END IF;
  RAISE NOTICE 'PASS: staff work is paid at its work item''s rate (9000) for its branch (Rucil)';
END $$;

DO $$ BEGIN RAISE NOTICE 'ALL WORK ITEM ASSIGNMENT TESTS PASSED'; END $$;

ROLLBACK;
