-- Tests for record_attendance(), the learning_period_status view and the RLS policies from
-- migration 20260803010000_learning_periods_attendance.sql.
--
-- Everything runs inside one transaction that ends in ROLLBACK, so it is safe against the
-- live project. It creates its own auth.users rows and impersonates them with
-- `SET LOCAL ROLE authenticated` + `request.jwt.claims`, which is what auth.uid() and
-- auth.jwt() read.
--
-- Run with either:
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/learning_periods.test.sql
--   ...or paste it into the SQL editor / the Supabase MCP execute_sql tool.
--
-- Every assertion RAISEs on failure. A clean run ends with 'ALL LEARNING PERIOD TESTS PASSED'.

BEGIN;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_app_meta_data, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-9000-000000000001', 'authenticated', 'authenticated', 'lp-admin@example.test',     '{"role":"admin"}',   now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-9000-000000000002', 'authenticated', 'authenticated', 'lp-teacher-a@example.test', '{"role":"teacher"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-9000-000000000003', 'authenticated', 'authenticated', 'lp-teacher-b@example.test', '{"role":"teacher"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-9000-000000000004', 'authenticated', 'authenticated', 'lp-parent-1@example.test',  '{"role":"parent"}',  now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-9000-000000000005', 'authenticated', 'authenticated', 'lp-parent-2@example.test',  '{"role":"parent"}',  now(), now());

INSERT INTO public.teachers (id, full_name, email, auth_user_id) VALUES
  ('00000000-0000-4000-9000-000000000012', 'LP Teacher A', 'lp-teacher-a@example.test', '00000000-0000-4000-9000-000000000002'),
  ('00000000-0000-4000-9000-000000000013', 'LP Teacher B', 'lp-teacher-b@example.test', '00000000-0000-4000-9000-000000000003');

INSERT INTO public.families (id, name, login_email, auth_user_id) VALUES
  ('00000000-0000-4000-9000-000000000014', 'LP Family One', 'lp-parent-1@example.test', '00000000-0000-4000-9000-000000000004'),
  ('00000000-0000-4000-9000-000000000015', 'LP Family Two', 'lp-parent-2@example.test', '00000000-0000-4000-9000-000000000005');

INSERT INTO public.children (id, family_id, full_name) VALUES
  ('00000000-0000-4000-9000-000000000016', '00000000-0000-4000-9000-000000000014', 'LP Child One'),
  ('00000000-0000-4000-9000-000000000017', '00000000-0000-4000-9000-000000000015', 'LP Child Two');

-- Classroom X and Y are both taught by teacher A; classroom Z by teacher B.
INSERT INTO public.classrooms (id, label, time_start) VALUES
  ('00000000-0000-4000-9000-000000000018', 'LP Classroom X', '09:00'),
  ('00000000-0000-4000-9000-000000000019', 'LP Classroom Y', '11:00'),
  ('00000000-0000-4000-9000-00000000001a', 'LP Classroom Z', '13:00');

INSERT INTO public.classroom_teachers (id, classroom_id, teacher_id) VALUES
  ('00000000-0000-4000-9000-000000000020', '00000000-0000-4000-9000-000000000018', '00000000-0000-4000-9000-000000000012'),
  ('00000000-0000-4000-9000-000000000021', '00000000-0000-4000-9000-000000000019', '00000000-0000-4000-9000-000000000012'),
  ('00000000-0000-4000-9000-000000000022', '00000000-0000-4000-9000-00000000001a', '00000000-0000-4000-9000-000000000013');

-- children_classrooms allows only one active enrollment per child
-- (children_classrooms_one_active_idx). The new tables model a child holding independent
-- periods in two separately-billed classrooms correctly, but that enrollment index blocks it
-- in production today. Dropping it here — inside a transaction that rolls back — lets the
-- two-classroom case below run through the real RPC instead of by direct insert.
DROP INDEX public.children_classrooms_one_active_idx;

INSERT INTO public.children_classrooms (child_id, classroom_teacher_id, started_at) VALUES
  ('00000000-0000-4000-9000-000000000016', '00000000-0000-4000-9000-000000000020', '2026-01-01'),
  ('00000000-0000-4000-9000-000000000016', '00000000-0000-4000-9000-000000000021', '2026-01-01'),
  ('00000000-0000-4000-9000-000000000017', '00000000-0000-4000-9000-000000000022', '2026-01-01');

-- Child One holds one period in X and an independent one in Y. Child Two has one in Z.
INSERT INTO public.learning_periods (id, child_id, classroom_id, period_no, start_date) VALUES
  ('00000000-0000-4000-9000-000000000030', '00000000-0000-4000-9000-000000000016', '00000000-0000-4000-9000-000000000018', 1, '2026-09-01'),
  ('00000000-0000-4000-9000-000000000031', '00000000-0000-4000-9000-000000000016', '00000000-0000-4000-9000-000000000019', 1, '2026-09-01'),
  ('00000000-0000-4000-9000-000000000032', '00000000-0000-4000-9000-000000000017', '00000000-0000-4000-9000-00000000001a', 1, '2026-09-01');

-- ---------------------------------------------------------------------------
-- Quota arithmetic — as teacher A
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-9000-000000000002","role":"authenticated","app_metadata":{"role":"teacher"}}';

DO $$
DECLARE
  v_child uuid := '00000000-0000-4000-9000-000000000016';
  v_room  uuid := '00000000-0000-4000-9000-000000000018';
  v_period uuid := '00000000-0000-4000-9000-000000000030';
  v_consumed bigint;
  v_sick bigint;
  v_remaining bigint;
  v_rows int;
BEGIN
  PERFORM public.record_attendance(v_child, v_room, '2026-09-01', 'present');
  PERFORM public.record_attendance(v_child, v_room, '2026-09-02', 'absent');
  PERFORM public.record_attendance(v_child, v_room, '2026-09-03', 'sick');

  SELECT days_consumed, days_sick, days_remaining
    INTO v_consumed, v_sick, v_remaining
    FROM public.learning_period_status WHERE id = v_period;

  IF v_consumed <> 2 OR v_sick <> 1 OR v_remaining <> 18 THEN
    RAISE EXCEPTION 'FAIL: present+absent must consume and sick must not (consumed %, sick %, remaining %)',
      v_consumed, v_sick, v_remaining;
  END IF;
  RAISE NOTICE 'PASS: present and absent consume a day, sick does not';

  -- A date with no attendance row consumes nothing: 2026-09-04 is deliberately untouched.
  SELECT count(*) INTO v_rows FROM public.child_attendances WHERE learning_period_id = v_period;
  IF v_rows <> 3 THEN
    RAISE EXCEPTION 'FAIL: expected exactly 3 attendance rows, got %', v_rows;
  END IF;
  SELECT days_remaining INTO v_remaining FROM public.learning_period_status WHERE id = v_period;
  IF v_remaining <> 18 THEN
    RAISE EXCEPTION 'FAIL: a date with no row must consume nothing (remaining %)', v_remaining;
  END IF;
  RAISE NOTICE 'PASS: a date with no attendance row consumes nothing';

  -- Re-submitting the same date corrects it instead of consuming a second day.
  PERFORM public.record_attendance(v_child, v_room, '2026-09-01', 'absent', 'salah tekan');
  SELECT count(*) INTO v_rows FROM public.child_attendances WHERE learning_period_id = v_period;
  SELECT days_consumed INTO v_consumed FROM public.learning_period_status WHERE id = v_period;
  IF v_rows <> 3 OR v_consumed <> 2 THEN
    RAISE EXCEPTION 'FAIL: re-submitting double-counted (% rows, % consumed)', v_rows, v_consumed;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.child_attendances
    WHERE learning_period_id = v_period AND attendance_date = '2026-09-01'
      AND status = 'absent' AND note = 'salah tekan'
  ) THEN
    RAISE EXCEPTION 'FAIL: re-submitting must update status and note in place';
  END IF;
  RAISE NOTICE 'PASS: re-submitting the same date updates rather than double-counting';

  -- Correcting present -> sick releases the day back.
  PERFORM public.record_attendance(v_child, v_room, '2026-09-01', 'sick');
  SELECT days_consumed, days_sick INTO v_consumed, v_sick
    FROM public.learning_period_status WHERE id = v_period;
  IF v_consumed <> 1 OR v_sick <> 2 THEN
    RAISE EXCEPTION 'FAIL: correcting to sick must release the day (consumed %, sick %)', v_consumed, v_sick;
  END IF;
  PERFORM public.record_attendance(v_child, v_room, '2026-09-01', 'present');
  RAISE NOTICE 'PASS: correcting a day to sick releases it back to the quota';
END $$;

-- ---------------------------------------------------------------------------
-- The period closes exactly on the 20th consuming day
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_child uuid := '00000000-0000-4000-9000-000000000016';
  v_room  uuid := '00000000-0000-4000-9000-000000000018';
  v_period uuid := '00000000-0000-4000-9000-000000000030';
  v_consumed bigint;
  v_closed timestamptz;
  v_actual_end date;
  v_remaining bigint;
  v_active boolean;
  v_day date;
BEGIN
  -- 2 consumed so far. Add 17 more present days (2026-09-04 .. 2026-09-20) to reach 19.
  FOR v_day IN SELECT generate_series('2026-09-04'::date, '2026-09-20'::date, '1 day')::date LOOP
    PERFORM public.record_attendance(v_child, v_room, v_day, 'present');
  END LOOP;

  SELECT days_consumed, closed_at INTO v_consumed, v_closed
    FROM public.learning_period_status WHERE id = v_period;
  IF v_consumed <> 19 THEN
    RAISE EXCEPTION 'FAIL: expected 19 consumed before the final day, got %', v_consumed;
  END IF;
  IF v_closed IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: period closed early, at 19 consumed days';
  END IF;
  RAISE NOTICE 'PASS: period still open at 19 consumed days';

  PERFORM public.record_attendance(v_child, v_room, '2026-09-21', 'present');

  SELECT days_consumed, days_remaining, closed_at, actual_end_date, is_active
    INTO v_consumed, v_remaining, v_closed, v_actual_end, v_active
    FROM public.learning_period_status WHERE id = v_period;

  IF v_consumed <> 20 OR v_remaining <> 0 THEN
    RAISE EXCEPTION 'FAIL: expected 20 consumed / 0 remaining, got % / %', v_consumed, v_remaining;
  END IF;
  IF v_closed IS NULL THEN
    RAISE EXCEPTION 'FAIL: period must close on the 20th consuming day';
  END IF;
  IF v_actual_end <> '2026-09-21' THEN
    RAISE EXCEPTION 'FAIL: actual_end_date should be the closing date, got %', v_actual_end;
  END IF;
  IF v_active THEN
    RAISE EXCEPTION 'FAIL: a closed, exhausted period must not report is_active';
  END IF;
  RAISE NOTICE 'PASS: period closes exactly on the 20th consuming day and stamps actual_end_date';

  -- With the period closed, a genuinely new date has nothing to draw from.
  BEGIN
    PERFORM public.record_attendance(v_child, v_room, '2026-09-22', 'present');
    RAISE EXCEPTION 'FAIL: recording a new date with no open period must fail loudly';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: no open period rejected (%)', SQLERRM;
  END;

  -- ...but correcting a date already filed against the closed period still works, and
  -- closing stays one-way.
  PERFORM public.record_attendance(v_child, v_room, '2026-09-21', 'sick');
  SELECT days_consumed, closed_at INTO v_consumed, v_closed
    FROM public.learning_period_status WHERE id = v_period;
  IF v_consumed <> 19 OR v_closed IS NULL THEN
    RAISE EXCEPTION 'FAIL: correcting inside a closed period should work and not reopen it (consumed %, closed %)',
      v_consumed, v_closed;
  END IF;
  PERFORM public.record_attendance(v_child, v_room, '2026-09-21', 'present');
  RAISE NOTICE 'PASS: a closed period still accepts corrections and never reopens itself';
END $$;

-- ---------------------------------------------------------------------------
-- Two classrooms on the same date drain separate quotas
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_child uuid := '00000000-0000-4000-9000-000000000016';
  v_room_y uuid := '00000000-0000-4000-9000-000000000019';
  v_period_x uuid := '00000000-0000-4000-9000-000000000030';
  v_period_y uuid := '00000000-0000-4000-9000-000000000031';
  v_x_consumed bigint;
  v_y_consumed bigint;
  v_rows int;
BEGIN
  PERFORM public.record_attendance(v_child, v_room_y, '2026-09-01', 'present');

  SELECT count(*) INTO v_rows FROM public.child_attendances
    WHERE child_id = v_child AND attendance_date = '2026-09-01';
  IF v_rows <> 2 THEN
    RAISE EXCEPTION 'FAIL: a child in two classrooms should have 2 rows on the same date, got %', v_rows;
  END IF;

  SELECT days_consumed INTO v_x_consumed FROM public.learning_period_status WHERE id = v_period_x;
  SELECT days_consumed INTO v_y_consumed FROM public.learning_period_status WHERE id = v_period_y;
  IF v_x_consumed <> 20 OR v_y_consumed <> 1 THEN
    RAISE EXCEPTION 'FAIL: quotas are not independent (X consumed %, Y consumed %)', v_x_consumed, v_y_consumed;
  END IF;
  RAISE NOTICE 'PASS: two classrooms on one date drain separate quotas';
END $$;

-- ---------------------------------------------------------------------------
-- Rejections
-- ---------------------------------------------------------------------------

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-9000-000000000001","role":"authenticated","app_metadata":{"role":"admin"}}';

DO $$
BEGIN
  -- The composite FK: period 31 belongs to classroom Y, so it cannot carry a classroom X row.
  BEGIN
    INSERT INTO public.child_attendances (learning_period_id, child_id, classroom_id, attendance_date, status)
    VALUES (
      '00000000-0000-4000-9000-000000000031',
      '00000000-0000-4000-9000-000000000016',
      '00000000-0000-4000-9000-000000000018',
      '2026-10-05',
      'present'
    );
    RAISE EXCEPTION 'FAIL: attendance filed against a period from another classroom must be rejected';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: composite FK blocks draining another classroom''s quota (%)', SQLERRM;
  END;

  -- Child Two is enrolled in classroom Z only.
  BEGIN
    PERFORM public.record_attendance(
      '00000000-0000-4000-9000-000000000017',
      '00000000-0000-4000-9000-000000000018',
      '2026-09-05',
      'present'
    );
    RAISE EXCEPTION 'FAIL: attendance for a child not enrolled in that classroom must be rejected';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: unenrolled child rejected (%)', SQLERRM;
  END;

  -- Unknown status never reaches the CHECK constraint.
  BEGIN
    PERFORM public.record_attendance(
      '00000000-0000-4000-9000-000000000017',
      '00000000-0000-4000-9000-00000000001a',
      '2026-09-05',
      'holiday'
    );
    RAISE EXCEPTION 'FAIL: an unknown status must be rejected';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: unknown status rejected (%)', SQLERRM;
  END;
END $$;

-- ---------------------------------------------------------------------------
-- RLS — teacher cannot write outside their own classrooms
-- ---------------------------------------------------------------------------

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-9000-000000000003","role":"authenticated","app_metadata":{"role":"teacher"}}';

DO $$
DECLARE
  v_rows int;
BEGIN
  -- Teacher B teaches classroom Z only.
  BEGIN
    PERFORM public.record_attendance(
      '00000000-0000-4000-9000-000000000016',
      '00000000-0000-4000-9000-000000000018',
      '2026-09-25',
      'present'
    );
    RAISE EXCEPTION 'FAIL: a teacher must not record attendance outside their own classrooms';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: cross-classroom write rejected (%)', SQLERRM;
  END;

  BEGIN
    INSERT INTO public.child_attendances (learning_period_id, child_id, classroom_id, attendance_date, status)
    VALUES (
      '00000000-0000-4000-9000-000000000030',
      '00000000-0000-4000-9000-000000000016',
      '00000000-0000-4000-9000-000000000018',
      '2026-09-26',
      'present'
    );
    RAISE EXCEPTION 'FAIL: RLS must block a direct insert outside the teacher''s classrooms';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: RLS blocks direct cross-classroom insert (%)', SQLERRM;
  END;

  SELECT count(*) INTO v_rows FROM public.child_attendances
    WHERE classroom_id = '00000000-0000-4000-9000-000000000018';
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'FAIL: teacher B can read attendance from a classroom they do not teach (% rows)', v_rows;
  END IF;
  RAISE NOTICE 'PASS: teacher cannot read attendance outside their own classrooms';
END $$;

-- ---------------------------------------------------------------------------
-- RLS — parents see their own family only
-- ---------------------------------------------------------------------------

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-9000-000000000004","role":"authenticated","app_metadata":{"role":"parent"}}';

DO $$
DECLARE
  v_attendances int;
  v_periods int;
BEGIN
  SELECT count(*) INTO v_attendances FROM public.child_attendances
    WHERE child_id = '00000000-0000-4000-9000-000000000016';
  SELECT count(*) INTO v_periods FROM public.learning_period_status
    WHERE child_id = '00000000-0000-4000-9000-000000000016';

  IF v_attendances = 0 OR v_periods <> 2 THEN
    RAISE EXCEPTION 'FAIL: parent 1 should see own child''s attendance and 2 periods (% rows, % periods)',
      v_attendances, v_periods;
  END IF;
  RAISE NOTICE 'PASS: parent reads own child''s periods and attendance through the view';
END $$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-9000-000000000005","role":"authenticated","app_metadata":{"role":"parent"}}';

DO $$
DECLARE
  v_attendances int;
  v_periods int;
BEGIN
  SELECT count(*) INTO v_attendances FROM public.child_attendances
    WHERE child_id = '00000000-0000-4000-9000-000000000016';
  SELECT count(*) INTO v_periods FROM public.learning_period_status
    WHERE child_id = '00000000-0000-4000-9000-000000000016';

  IF v_attendances <> 0 THEN
    RAISE EXCEPTION 'FAIL: parent 2 can read family 1''s attendance (% rows)', v_attendances;
  END IF;
  IF v_periods <> 0 THEN
    RAISE EXCEPTION 'FAIL: parent 2 can read family 1''s periods through the view (% rows)', v_periods;
  END IF;
  RAISE NOTICE 'PASS: parent cannot read another family''s periods or attendance';
END $$;

RESET ROLE;

SELECT 'ALL LEARNING PERIOD TESTS PASSED' AS result;

ROLLBACK;
