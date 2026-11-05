-- Tests for flexi-hours work sessions: the classroom_teacher_work_sessions table, the Mulai →
-- Selesai → Lanjutkan cycle through the two clock RPCs, the summed minutes_taught in
-- classroom_teachers_attendance_status, and the admin-edit collapse trigger (migration
-- 20261106010000).
--
-- Everything runs inside one transaction that ends in ROLLBACK, so it is safe to run against the
-- live project: no fixture survives the script. It creates its own auth.users rows and
-- impersonates them with `SET LOCAL ROLE authenticated` + `request.jwt.claims`, which is what
-- auth.uid() and auth.jwt() read.
--
-- Run with either:
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/flexi_work_sessions.test.sql
--   ...or paste it into the SQL editor / the Supabase MCP execute_sql tool.
--
-- Every assertion RAISEs on failure, so any output containing 'FAIL' — or an aborted run — means
-- a broken test. A clean run ends with 'ALL FLEXI WORK SESSION TESTS PASSED'.
--
-- Two things shape how this is written:
--   * The RPCs read today's WITA date and now() themselves, so the fixtures cannot use a fixed
--     date. is_flexi_hours classrooms are what make the script deterministic anyway: they skip
--     every window check, so the cycle below behaves identically whatever time of day — or day of
--     week — the suite runs.
--   * now() does not advance inside a transaction, so every session the RPCs open would otherwise
--     be zero minutes long and the sums would prove nothing. Each session is backdated between
--     the clock-in and the clock-out, with app.work_sessions_managed set so that the backdating
--     write does not itself trip the admin-edit collapse trigger.

BEGIN;

-- ---------------------------------------------------------------------------
-- Fixtures: one teacher, one flexi programme, one scheduled class as the control.
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_app_meta_data, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-b000-000000000001', 'authenticated', 'authenticated', 'flexi-test-admin@example.test',   '{"role":"admin"}',   now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-b000-000000000002', 'authenticated', 'authenticated', 'flexi-test-teacher@example.test', '{"role":"teacher"}', now(), now());

INSERT INTO public.teachers (id, full_name, call_name, email, auth_user_id) VALUES
  ('00000000-0000-4000-b000-000000000010', 'Flexi Test Teacher', 'Bu F', 'flexi-test-teacher@example.test', '00000000-0000-4000-b000-000000000002');

-- The scheduled control runs 00:00–23:59 so that its own clock-in window ("from an hour before
-- the start") is open whenever this suite runs — the point of it is the sessions behaviour, not
-- the window, and a realistic 10:00–12:00 would make the script pass or fail by wall-clock time.
INSERT INTO public.classrooms (id, label, time_start, time_end, price, is_billable, is_flexi_hours) VALUES
  ('00000000-0000-4000-b000-000000000018', 'Flexi Test Programme', '08:00', '17:00', 0, false, true),
  ('00000000-0000-4000-b000-000000000019', 'Flexi Test Scheduled', '00:00', '23:59', 0, true,  false);

INSERT INTO public.classroom_teachers (id, classroom_id, teacher_id) VALUES
  ('00000000-0000-4000-b000-000000000020', '00000000-0000-4000-b000-000000000018', '00000000-0000-4000-b000-000000000010'),
  ('00000000-0000-4000-b000-000000000021', '00000000-0000-4000-b000-000000000019', '00000000-0000-4000-b000-000000000010');

-- Shorthands, so each assertion below reads as the thing it is checking rather than as a join.
CREATE OR REPLACE FUNCTION pg_temp.attendance_id(p_group uuid) RETURNS uuid LANGUAGE sql STABLE AS $fn$
  SELECT id FROM public.classroom_teachers_attendances
   WHERE classroom_teacher_id = p_group
     AND session_date = (now() AT TIME ZONE 'Asia/Makassar')::date;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.minutes(p_group uuid) RETURNS int LANGUAGE sql STABLE AS $fn$
  SELECT minutes_taught FROM public.classroom_teachers_attendance_status
   WHERE classroom_teacher_id = p_group
     AND session_date = (now() AT TIME ZONE 'Asia/Makassar')::date;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.session_count(p_group uuid) RETURNS int LANGUAGE sql STABLE AS $fn$
  SELECT work_session_count FROM public.classroom_teachers_attendance_status
   WHERE classroom_teacher_id = p_group
     AND session_date = (now() AT TIME ZONE 'Asia/Makassar')::date;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.open_sessions(p_group uuid) RETURNS int LANGUAGE sql STABLE AS $fn$
  SELECT count(*)::int FROM public.classroom_teacher_work_sessions
   WHERE attendance_id = pg_temp.attendance_id(p_group) AND ended_at IS NULL;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.clocked_out_at(p_group uuid) RETURNS timestamptz LANGUAGE sql STABLE AS $fn$
  SELECT clocked_out_at FROM public.classroom_teachers_attendances
   WHERE id = pg_temp.attendance_id(p_group);
$fn$;

-- Stands in for the passage of time, which a transaction does not have: now() is frozen, so every
-- session the RPCs open would otherwise be zero minutes long. Pushes the running session back and
-- restates the day's jam masuk as its first session's start, which is the invariant the RPCs
-- themselves maintain.
--
-- SECURITY DEFINER because this is fixture manipulation, not behaviour under test: the teacher
-- role has no UPDATE policy on either table — the RPCs are deliberately its only write path — so
-- as the invoker these writes match no rows and silently do nothing. The read helpers above stay
-- invoker-rights on purpose, so that the assertions still go through the teacher's own RLS and a
-- missing SELECT policy would fail the suite rather than hide behind a definer read.
--
-- app.work_sessions_managed is what stops sync_flexi_work_sessions reading this as an admin
-- correction and collapsing the day it is setting up.
CREATE OR REPLACE FUNCTION pg_temp.backdate_open_session(p_group uuid, p_interval interval)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_attendance_id uuid := pg_temp.attendance_id(p_group);
BEGIN
  PERFORM set_config('app.work_sessions_managed', 'on', true);

  UPDATE public.classroom_teacher_work_sessions
    SET started_at = started_at - p_interval
    WHERE attendance_id = v_attendance_id AND ended_at IS NULL;

  UPDATE public.classroom_teachers_attendances
    SET clocked_in_at = (
      SELECT min(started_at) FROM public.classroom_teacher_work_sessions
       WHERE attendance_id = v_attendance_id
    )
    WHERE id = v_attendance_id;

  PERFORM set_config('app.work_sessions_managed', '', true);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- The cycle, driven through the real RPCs as the teacher herself.
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-b000-000000000002","role":"authenticated","app_metadata":{"role":"teacher"}}';

DO $$
DECLARE
  v_group uuid := '00000000-0000-4000-b000-000000000020';
BEGIN
  -- Mulai
  PERFORM public.clock_in_classroom_teacher(v_group);

  IF pg_temp.session_count(v_group) <> 1 OR pg_temp.open_sessions(v_group) <> 1 THEN
    RAISE EXCEPTION 'FAIL: Mulai must open exactly one running session, got % total / % open',
      pg_temp.session_count(v_group), pg_temp.open_sessions(v_group);
  END IF;
  IF pg_temp.minutes(v_group) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: nothing is finished yet, so the day must have no minutes';
  END IF;
  RAISE NOTICE 'PASS: Mulai opens one running session and banks no minutes yet';

  -- A stray double-tap is not a second session. The one-open-session index would refuse it
  -- outright; the RPC turns that into a quiet no-op.
  PERFORM public.clock_in_classroom_teacher(v_group);
  IF pg_temp.session_count(v_group) <> 1 THEN
    RAISE EXCEPTION 'FAIL: tapping Mulai twice must not open a parallel session, got %',
      pg_temp.session_count(v_group);
  END IF;
  RAISE NOTICE 'PASS: a double-tapped Mulai stays one session';

  -- Selesai, on a session two hours long.
  PERFORM pg_temp.backdate_open_session(v_group, interval '2 hours');
  PERFORM public.clock_out_classroom_teacher(v_group);

  IF pg_temp.minutes(v_group) <> 120 THEN
    RAISE EXCEPTION 'FAIL: a finished two-hour session must read 120 minutes, got %',
      pg_temp.minutes(v_group);
  END IF;
  IF pg_temp.open_sessions(v_group) <> 0 THEN
    RAISE EXCEPTION 'FAIL: Selesai must leave nothing running';
  END IF;
  RAISE NOTICE 'PASS: Selesai closes the session and banks its 120 minutes';

  -- Double-tapped Selesai must not reopen the day — Lanjutkan is the button that does that.
  PERFORM public.clock_out_classroom_teacher(v_group);
  IF pg_temp.minutes(v_group) <> 120 OR pg_temp.open_sessions(v_group) <> 0 THEN
    RAISE EXCEPTION 'FAIL: tapping Selesai twice must change nothing';
  END IF;
  RAISE NOTICE 'PASS: a double-tapped Selesai leaves the finished day alone';

  -- Lanjutkan: the same RPC as Mulai, now opening a second session. This is the whole point of
  -- the change — before it, the day was over and this was unreachable.
  PERFORM public.clock_in_classroom_teacher(v_group);

  IF pg_temp.session_count(v_group) <> 2 OR pg_temp.open_sessions(v_group) <> 1 THEN
    RAISE EXCEPTION 'FAIL: Lanjutkan must add a second running session, got % total / % open',
      pg_temp.session_count(v_group), pg_temp.open_sessions(v_group);
  END IF;
  IF pg_temp.clocked_out_at(v_group) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: a resumed day is running again and must have no jam selesai';
  END IF;
  IF pg_temp.minutes(v_group) <> 120 THEN
    RAISE EXCEPTION 'FAIL: resuming must not disturb the 120 minutes already banked, got %',
      pg_temp.minutes(v_group);
  END IF;
  RAISE NOTICE 'PASS: Lanjutkan reopens the day, keeping what was already banked';

  -- Selesai again, on a one-hour second session.
  PERFORM pg_temp.backdate_open_session(v_group, interval '1 hour');
  PERFORM public.clock_out_classroom_teacher(v_group);

  -- The assertion this whole migration exists for: 2h + 1h = 180, NOT the span from the first
  -- start to the last finish, which would also bill the unworked gap between the two sessions.
  IF pg_temp.minutes(v_group) <> 180 THEN
    RAISE EXCEPTION 'FAIL: two sessions of 2h and 1h must total 180 minutes, got %',
      pg_temp.minutes(v_group);
  END IF;
  IF pg_temp.session_count(v_group) <> 2 THEN
    RAISE EXCEPTION 'FAIL: the day should still be two sessions, got %', pg_temp.session_count(v_group);
  END IF;
  RAISE NOTICE 'PASS: the day totals the sum of its sessions, not the span across them';
END $$;

-- ---------------------------------------------------------------------------
-- A scheduled class is untouched: no sessions, and minutes still come from the pair.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_group uuid := '00000000-0000-4000-b000-000000000021';
BEGIN
  PERFORM public.clock_in_classroom_teacher(v_group);

  IF pg_temp.session_count(v_group) <> 0 THEN
    RAISE EXCEPTION 'FAIL: a scheduled class must never get work-session rows, got %',
      pg_temp.session_count(v_group);
  END IF;
  RAISE NOTICE 'PASS: a scheduled class records no work sessions';

  -- Still idempotent the old way: on a scheduled class a second tap must not shift the recorded
  -- time, which is the behaviour the flexi branch deliberately no longer shares.
  DECLARE
    v_first timestamptz := (SELECT clocked_in_at FROM public.classroom_teachers_attendances
                             WHERE id = pg_temp.attendance_id(v_group));
  BEGIN
    PERFORM public.clock_in_classroom_teacher(v_group);
    IF (SELECT clocked_in_at FROM public.classroom_teachers_attendances
         WHERE id = pg_temp.attendance_id(v_group)) <> v_first THEN
      RAISE EXCEPTION 'FAIL: a second Masuk Kelas must not shift a scheduled class''s jam masuk';
    END IF;
  END;
  RAISE NOTICE 'PASS: Masuk Kelas stays idempotent on a scheduled class';
END $$;

RESET ROLE;
SET LOCAL request.jwt.claims = '';

-- ---------------------------------------------------------------------------
-- The admin correction: one typed pair replaces the sessions, and the duration follows it.
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-b000-000000000001","role":"authenticated","app_metadata":{"role":"admin"}}';

DO $$
DECLARE
  v_group uuid := '00000000-0000-4000-b000-000000000020';
  v_day date := (now() AT TIME ZONE 'Asia/Makassar')::date;
  v_in timestamptz;
  v_out timestamptz;
BEGIN
  v_in := (v_day::text || ' 08:00')::timestamp AT TIME ZONE 'Asia/Makassar';
  v_out := (v_day::text || ' 16:00')::timestamp AT TIME ZONE 'Asia/Makassar';

  -- Exactly what saveClassroomTeacherAttendance sends from the Kehadiran Guru dialog.
  UPDATE public.classroom_teachers_attendances
    SET clocked_in_at = v_in, clocked_in_source = 'admin',
        clocked_out_at = v_out, clocked_out_source = 'admin',
        edited_by = '00000000-0000-4000-b000-000000000001'
    WHERE id = pg_temp.attendance_id(v_group);

  IF pg_temp.session_count(v_group) <> 1 THEN
    RAISE EXCEPTION 'FAIL: an admin correction must collapse the day to one session, got %',
      pg_temp.session_count(v_group);
  END IF;
  IF pg_temp.minutes(v_group) <> 480 THEN
    RAISE EXCEPTION 'FAIL: the corrected day must read the 480 minutes the admin typed, got %',
      pg_temp.minutes(v_group);
  END IF;
  RAISE NOTICE 'PASS: an admin correction collapses the sessions and the duration follows it';

  -- Re-saving the same values changes nothing: the trigger only acts on a pair that moved, so
  -- opening the dialog and pressing Simpan without editing is not a destructive act.
  UPDATE public.classroom_teachers_attendances
    SET clocked_in_at = v_in, clocked_out_at = v_out, notes = 'tidak mengubah jam'
    WHERE id = pg_temp.attendance_id(v_group);

  IF pg_temp.minutes(v_group) <> 480 OR pg_temp.session_count(v_group) <> 1 THEN
    RAISE EXCEPTION 'FAIL: re-saving unchanged times must not disturb the day';
  END IF;
  RAISE NOTICE 'PASS: saving a correction that changes no times is a no-op';

  -- Clearing the jam masuk clears the day entirely rather than leaving orphaned sessions behind.
  UPDATE public.classroom_teachers_attendances
    SET clocked_in_at = NULL, clocked_in_source = NULL,
        clocked_out_at = NULL, clocked_out_source = NULL
    WHERE id = pg_temp.attendance_id(v_group);

  IF pg_temp.session_count(v_group) <> 0 THEN
    RAISE EXCEPTION 'FAIL: clearing the punch must leave no sessions behind, got %',
      pg_temp.session_count(v_group);
  END IF;
  RAISE NOTICE 'PASS: clearing an admin-corrected day removes its sessions too';
END $$;

RESET ROLE;
SET LOCAL request.jwt.claims = '';

-- ---------------------------------------------------------------------------
-- A flexi day logged before this migration has no sessions. Resuming it must fold the original
-- pair in as the first session rather than letting the day restart from the new one.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_group uuid := '00000000-0000-4000-b000-000000000020';
  v_day date := (now() AT TIME ZONE 'Asia/Makassar')::date;
BEGIN
  -- Rebuild the legacy shape: a finished pair with no session rows under it.
  PERFORM set_config('app.work_sessions_managed', 'on', true);
  DELETE FROM public.classroom_teacher_work_sessions
    WHERE attendance_id = pg_temp.attendance_id(v_group);
  UPDATE public.classroom_teachers_attendances
    SET clocked_in_at = now() - interval '5 hours', clocked_in_source = 'teacher',
        clocked_out_at = now() - interval '2 hours', clocked_out_source = 'teacher'
    WHERE id = pg_temp.attendance_id(v_group);
  PERFORM set_config('app.work_sessions_managed', '', true);

  IF pg_temp.session_count(v_group) <> 0 OR pg_temp.minutes(v_group) <> 180 THEN
    RAISE EXCEPTION 'FAIL: the legacy fixture should be 180 minutes across no sessions, got % / %',
      pg_temp.minutes(v_group), pg_temp.session_count(v_group);
  END IF;
  RAISE NOTICE 'PASS: a session-less flexi day still reads its minutes from the pair';
END $$;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-b000-000000000002","role":"authenticated","app_metadata":{"role":"teacher"}}';

DO $$
DECLARE
  v_group uuid := '00000000-0000-4000-b000-000000000020';
BEGIN
  PERFORM public.clock_in_classroom_teacher(v_group);

  IF pg_temp.session_count(v_group) <> 2 THEN
    RAISE EXCEPTION 'FAIL: resuming a legacy day must keep its original stretch as session 1, got %',
      pg_temp.session_count(v_group);
  END IF;
  -- The regression this guards: without materialize_flexi_work_session the day would switch to
  -- "sum of sessions" holding only the new one, and the three hours already worked would vanish.
  IF pg_temp.minutes(v_group) <> 180 THEN
    RAISE EXCEPTION 'FAIL: resuming must not discard the 180 minutes already logged, got %',
      pg_temp.minutes(v_group);
  END IF;
  RAISE NOTICE 'PASS: resuming a day logged before the migration keeps its minutes';

  PERFORM pg_temp.backdate_open_session(v_group, interval '30 minutes');
  PERFORM public.clock_out_classroom_teacher(v_group);

  IF pg_temp.minutes(v_group) <> 210 THEN
    RAISE EXCEPTION 'FAIL: 180 banked plus a 30-minute session must be 210, got %',
      pg_temp.minutes(v_group);
  END IF;
  RAISE NOTICE 'PASS: the resumed legacy day totals both stretches';
END $$;

RESET ROLE;
SET LOCAL request.jwt.claims = '';

DO $$ BEGIN RAISE NOTICE 'ALL FLEXI WORK SESSION TESTS PASSED'; END $$;

ROLLBACK;
