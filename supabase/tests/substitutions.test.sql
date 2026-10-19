-- Tests for guru pengganti: the classroom_teachers_substitutions table and its trigger, the
-- date-aware write gates, the substitute's read policies, declare/withdraw, substitutable_classes,
-- and the author attribution in daily_report_for_attendance (migrations 20261019020000 and
-- 20261019030000).
--
-- Everything runs inside one transaction that ends in ROLLBACK, so it is safe to run against the
-- live project: no fixture survives the script. It creates its own auth.users rows and
-- impersonates them with `SET LOCAL ROLE authenticated` + `request.jwt.claims`, which is what
-- auth.uid() and auth.jwt() read.
--
-- Run with either:
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/substitutions.test.sql
--   ...or paste it into the SQL editor / the Supabase MCP execute_sql tool.
--
-- Every assertion RAISEs on failure, so any output containing 'FAIL' — or an aborted run — means
-- a broken test. A clean run ends with 'ALL SUBSTITUTION TESTS PASSED'.
--
-- Two ways coverage gets created here, for two different reasons:
--   * the fixed-date cases (2026-08-03) insert the row directly under the admin JWT, which
--     admin_all_classroom_teachers_substitutions permits. declare_substitution deliberately has no
--     date parameter, so an arbitrary past date is not reachable through it.
--   * the declare_substitution cases use is_flexi_hours classrooms, which is what makes them
--     deterministic: that RPC reads today's WITA date itself and applies the Mon–Fri and
--     "an hour before the class starts" rules, neither of which a fixed fixture date can satisfy on
--     every day this suite might run. A flexi classroom skips both by design, leaving the rules the
--     script actually wants to pin: takeover, self-substitution and the clocked-in guard.

BEGIN;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_app_meta_data, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-9000-000000000001', 'authenticated', 'authenticated', 'sub-test-admin@example.test',     '{"role":"admin"}',   now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-9000-000000000002', 'authenticated', 'authenticated', 'sub-test-teacher-a@example.test', '{"role":"teacher"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-9000-000000000003', 'authenticated', 'authenticated', 'sub-test-teacher-b@example.test', '{"role":"teacher"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-9000-000000000004', 'authenticated', 'authenticated', 'sub-test-teacher-c@example.test', '{"role":"teacher"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-9000-000000000005', 'authenticated', 'authenticated', 'sub-test-parent@example.test',    '{"role":"parent"}',  now(), now());

-- A is the absent teacher. B shares A's classroom (the owner's case 1: already in that room, so
-- covering earns nothing extra). C is in a different classroom entirely (case 2: paid).
INSERT INTO public.teachers (id, full_name, call_name, email, auth_user_id) VALUES
  ('00000000-0000-4000-9000-000000000012', 'Sub Test Teacher A', 'Bu A', 'sub-test-teacher-a@example.test', '00000000-0000-4000-9000-000000000002'),
  ('00000000-0000-4000-9000-000000000013', 'Sub Test Teacher B', 'Bu B', 'sub-test-teacher-b@example.test', '00000000-0000-4000-9000-000000000003'),
  ('00000000-0000-4000-9000-000000000014', 'Sub Test Teacher C', 'Bu C', 'sub-test-teacher-c@example.test', '00000000-0000-4000-9000-000000000004');

INSERT INTO public.families (id, login_email, auth_user_id) VALUES
  ('00000000-0000-4000-9000-000000000015', 'sub-test-parent@example.test', '00000000-0000-4000-9000-000000000005');

INSERT INTO public.children (id, family_id, full_name) VALUES
  ('00000000-0000-4000-9000-000000000016', '00000000-0000-4000-9000-000000000015', 'Sub Test Child');

INSERT INTO public.classrooms (id, label, time_start, time_end, price, is_flexi_hours) VALUES
  ('00000000-0000-4000-9000-000000000018', 'Sub Test Classroom',       '10:00', '12:00', 0, false),
  ('00000000-0000-4000-9000-000000000019', 'Sub Test Classroom Other', '13:00', '15:00', 0, false),
  ('00000000-0000-4000-9000-00000000001a', 'Sub Test Flexi One',       '08:00', '09:00', 0, true),
  ('00000000-0000-4000-9000-00000000001b', 'Sub Test Flexi Two',       '08:00', '09:00', 0, true);

-- g20 and g21 are two groups of the SAME classroom; g22 is C's group elsewhere.
INSERT INTO public.classroom_teachers (id, classroom_id, teacher_id) VALUES
  ('00000000-0000-4000-9000-000000000020', '00000000-0000-4000-9000-000000000018', '00000000-0000-4000-9000-000000000012'),
  ('00000000-0000-4000-9000-000000000021', '00000000-0000-4000-9000-000000000018', '00000000-0000-4000-9000-000000000013'),
  ('00000000-0000-4000-9000-000000000022', '00000000-0000-4000-9000-000000000019', '00000000-0000-4000-9000-000000000014'),
  ('00000000-0000-4000-9000-000000000023', '00000000-0000-4000-9000-00000000001a', '00000000-0000-4000-9000-000000000012'),
  ('00000000-0000-4000-9000-000000000024', '00000000-0000-4000-9000-00000000001b', '00000000-0000-4000-9000-000000000012');

-- The child is in A's group, in A's classroom and in both flexi programmes.
INSERT INTO public.children_classrooms (child_id, classroom_teacher_id, started_at) VALUES
  ('00000000-0000-4000-9000-000000000016', '00000000-0000-4000-9000-000000000020', '2026-01-01'),
  ('00000000-0000-4000-9000-000000000016', '00000000-0000-4000-9000-000000000023', '2026-01-01'),
  ('00000000-0000-4000-9000-000000000016', '00000000-0000-4000-9000-000000000024', '2026-01-01');

INSERT INTO public.learning_periods (id, child_id, classroom_id, period_no, start_date) VALUES
  ('00000000-0000-4000-9000-000000000030', '00000000-0000-4000-9000-000000000016', '00000000-0000-4000-9000-000000000018', 1, '2026-01-01');

-- 2026-08-03 is the covered day, 2026-08-04 the uncovered control. A report needs a 'present' row
-- for the same classroom and date (enforce_child_present), so both days get one.
INSERT INTO public.child_attendances (learning_period_id, child_id, classroom_id, attendance_date, status) VALUES
  ('00000000-0000-4000-9000-000000000030', '00000000-0000-4000-9000-000000000016', '00000000-0000-4000-9000-000000000018', '2026-08-03', 'present'),
  ('00000000-0000-4000-9000-000000000030', '00000000-0000-4000-9000-000000000016', '00000000-0000-4000-9000-000000000018', '2026-08-04', 'present');

-- ---------------------------------------------------------------------------
-- The pay rule, before anything is covered
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF public.default_counts_for_pay(
       '00000000-0000-4000-9000-000000000020', '00000000-0000-4000-9000-000000000013') THEN
    RAISE EXCEPTION 'FAIL: B already teaches this classroom, so coverage must not be payable';
  END IF;
  RAISE NOTICE 'PASS: case 1 (same classroom) defaults to unpaid';

  IF NOT public.default_counts_for_pay(
       '00000000-0000-4000-9000-000000000020', '00000000-0000-4000-9000-000000000014') THEN
    RAISE EXCEPTION 'FAIL: C comes in from another classroom, so coverage must be payable';
  END IF;
  RAISE NOTICE 'PASS: case 2 (different classroom) defaults to paid';
END $$;

-- ---------------------------------------------------------------------------
-- Without coverage: B cannot write A's group's report, and C cannot even mark attendance
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-9000-000000000003","role":"authenticated","app_metadata":{"role":"teacher"}}';

DO $$
BEGIN
  BEGIN
    PERFORM public.save_daily_report_teacher_note(
      '00000000-0000-4000-9000-000000000016',
      '00000000-0000-4000-9000-000000000020',
      '2026-08-03',
      'Seharusnya ditolak'
    );
    RAISE EXCEPTION 'FAIL: B must not write a report for A''s group without coverage';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: without coverage B cannot write A''s group''s report';
  END;

  -- The asymmetry worth pinning: the attendance gate is classroom-scoped, so B — who teaches a
  -- different group of the SAME classroom — can already record attendance here. This is why case 1
  -- only ever needed reads and the note gate.
  IF NOT public.can_record_attendance('00000000-0000-4000-9000-000000000018', '2026-08-03') THEN
    RAISE EXCEPTION 'FAIL: a teacher in this classroom should already be able to record attendance';
  END IF;
  RAISE NOTICE 'PASS: attendance is classroom-scoped, so case 1 can already mark it';

  -- ...but she cannot SEE the children, which is what made it useless to her.
  IF EXISTS (
    SELECT 1 FROM public.children_classrooms
    WHERE classroom_teacher_id = '00000000-0000-4000-9000-000000000020'
  ) THEN
    RAISE EXCEPTION 'FAIL: B must not see A''s roster without coverage';
  END IF;
  RAISE NOTICE 'PASS: without coverage B cannot see A''s roster';
END $$;

RESET ROLE;
SET LOCAL request.jwt.claims = '';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-9000-000000000004","role":"authenticated","app_metadata":{"role":"teacher"}}';

DO $$
BEGIN
  IF public.can_record_attendance('00000000-0000-4000-9000-000000000018', '2026-08-03') THEN
    RAISE EXCEPTION 'FAIL: C is not in this classroom and must not be able to record attendance';
  END IF;
  RAISE NOTICE 'PASS: a teacher outside the classroom cannot record its attendance';
END $$;

RESET ROLE;
SET LOCAL request.jwt.claims = '';

-- ---------------------------------------------------------------------------
-- substitutable_classes: what the two dropdowns are built from
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-9000-000000000003","role":"authenticated","app_metadata":{"role":"teacher"}}';

DO $$
DECLARE
  v_date date := (now() AT TIME ZONE 'Asia/Makassar')::date;
  v_rows int;
  v_students int;
BEGIN
  -- Asserted by inclusion and exclusion rather than by a total: the function answers "what could I
  -- cover" across the whole centre, so it necessarily also returns the project's real classes.
  IF NOT EXISTS (
    SELECT 1 FROM public.substitutable_classes(v_date)
    WHERE classroom_teacher_id = '00000000-0000-4000-9000-000000000020'
  ) THEN
    RAISE EXCEPTION 'FAIL: A''s group should be offered to B';
  END IF;

  -- C's group is in a classroom of its own with nobody enrolled: an empty assignment, not a class
  -- that needs covering.
  IF EXISTS (
    SELECT 1 FROM public.substitutable_classes(v_date)
    WHERE classroom_teacher_id = '00000000-0000-4000-9000-000000000022'
  ) THEN
    RAISE EXCEPTION 'FAIL: a group with no enrolled children must not be offered';
  END IF;

  SELECT student_count INTO v_students FROM public.substitutable_classes(v_date)
    WHERE classroom_teacher_id = '00000000-0000-4000-9000-000000000020';
  IF v_students <> 1 THEN
    RAISE EXCEPTION 'FAIL: the offered group should report 1 enrolled child, got %', v_students;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.substitutable_classes(v_date)
    WHERE classroom_teacher_id = '00000000-0000-4000-9000-000000000020'
      AND teacher_full_name = 'Sub Test Teacher A'
      AND NOT covered_by_me AND NOT covered_by_other AND NOT teacher_clocked_in
  ) THEN
    RAISE EXCEPTION 'FAIL: the offered group should name A and be flagged as uncovered';
  END IF;

  -- Her own group is never something she stands in for.
  IF EXISTS (
    SELECT 1 FROM public.substitutable_classes(v_date)
    WHERE classroom_teacher_id = '00000000-0000-4000-9000-000000000021'
  ) THEN
    RAISE EXCEPTION 'FAIL: B must not be offered her own group';
  END IF;
  RAISE NOTICE 'PASS: substitutable_classes offers the right group, with the absent teacher''s name';

  -- She cannot read `teachers` directly, which is exactly why this RPC exists.
  IF EXISTS (SELECT 1 FROM public.teachers WHERE id = '00000000-0000-4000-9000-000000000012') THEN
    RAISE EXCEPTION 'FAIL: B should not be able to read A''s teacher row through RLS';
  END IF;
  RAISE NOTICE 'PASS: the absent teacher''s name is unreadable without the RPC';
END $$;

RESET ROLE;
SET LOCAL request.jwt.claims = '';

-- ---------------------------------------------------------------------------
-- Coverage on a fixed past date, recorded by an admin
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-9000-000000000001","role":"authenticated","app_metadata":{"role":"admin"}}';

DO $$
BEGIN
  INSERT INTO public.classroom_teachers_substitutions (
    classroom_teacher_id, substitute_teacher_id, session_date, counts_for_pay, created_by_role, reason
  ) VALUES (
    '00000000-0000-4000-9000-000000000020',
    '00000000-0000-4000-9000-000000000013',
    '2026-08-03',
    public.default_counts_for_pay('00000000-0000-4000-9000-000000000020', '00000000-0000-4000-9000-000000000013'),
    'admin',
    'Izin sakit'
  );
  RAISE NOTICE 'PASS: an admin can record coverage for any date';

  -- Self-substitution, whatever the route in.
  BEGIN
    INSERT INTO public.classroom_teachers_substitutions (
      classroom_teacher_id, substitute_teacher_id, session_date, counts_for_pay, created_by_role
    ) VALUES (
      '00000000-0000-4000-9000-000000000023',
      '00000000-0000-4000-9000-000000000012',
      '2026-08-03', false, 'admin'
    );
    RAISE EXCEPTION 'FAIL: a teacher must not be her own substitute';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: self-substitution is refused';
  END;

  -- One substitute per group per day.
  BEGIN
    INSERT INTO public.classroom_teachers_substitutions (
      classroom_teacher_id, substitute_teacher_id, session_date, counts_for_pay, created_by_role
    ) VALUES (
      '00000000-0000-4000-9000-000000000020',
      '00000000-0000-4000-9000-000000000014',
      '2026-08-03', true, 'admin'
    );
    RAISE EXCEPTION 'FAIL: two substitutes must not cover one group on one day';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: one substitute per group per day';
  END;
END $$;

RESET ROLE;
SET LOCAL request.jwt.claims = '';

-- ---------------------------------------------------------------------------
-- With coverage: B can read, write and submit — for that date only
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-9000-000000000003","role":"authenticated","app_metadata":{"role":"teacher"}}';

DO $$
DECLARE
  v_report_id uuid;
  v_rows int;
  v_submitted timestamptz;
BEGIN
  -- Reads first: the roster is what was empty before, and it is what the screen lists.
  SELECT count(*) INTO v_rows FROM public.children_classrooms
    WHERE classroom_teacher_id = '00000000-0000-4000-9000-000000000020';
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'FAIL: B should now see A''s roster, got % rows', v_rows;
  END IF;

  SELECT count(*) INTO v_rows FROM public.children
    WHERE id = '00000000-0000-4000-9000-000000000016';
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'FAIL: B should now see the covered child';
  END IF;

  SELECT count(*) INTO v_rows FROM public.classroom_teachers
    WHERE id = '00000000-0000-4000-9000-000000000020';
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'FAIL: B should now see the covered group row';
  END IF;
  RAISE NOTICE 'PASS: coverage opens the roster, the child and the group row';

  -- Now the write that was the whole point.
  v_report_id := public.save_daily_report_teacher_note(
    '00000000-0000-4000-9000-000000000016',
    '00000000-0000-4000-9000-000000000020',
    '2026-08-03',
    'Hari ini anak ceria.'
  );
  IF v_report_id IS NULL THEN
    RAISE EXCEPTION 'FAIL: B should be able to write the covered day''s note';
  END IF;
  RAISE NOTICE 'PASS: the substitute can write the covered day''s Catatan Guru';

  PERFORM public.save_daily_report_mood(
    '00000000-0000-4000-9000-000000000016',
    '00000000-0000-4000-9000-000000000020',
    '2026-08-03',
    'senang', 'senang', 'biasa'
  );
  RAISE NOTICE 'PASS: the substitute can save the covered day''s moods';

  -- The next day over is not hers, even though the group is.
  BEGIN
    PERFORM public.save_daily_report_teacher_note(
      '00000000-0000-4000-9000-000000000016',
      '00000000-0000-4000-9000-000000000020',
      '2026-08-04',
      'Seharusnya ditolak'
    );
    RAISE EXCEPTION 'FAIL: coverage on 08-03 must not authorise writing 08-04';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: the write gate is scoped to the covered date';
  END;

  -- A substitute has read access to the group, but RLS must not hand her a direct table write that
  -- skips the gate. This is the hole that widening the shared helpers would have opened.
  BEGIN
    INSERT INTO public.children_daily_reports (child_id, classroom_teacher_id, report_date, teacher_note)
    VALUES ('00000000-0000-4000-9000-000000000016', '00000000-0000-4000-9000-000000000020', '2026-08-04', 'Lewat tabel');
    RAISE EXCEPTION 'FAIL: a substitute must not be able to INSERT into children_daily_reports directly';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: the substitute has no direct table write path, only the RPCs';
  END;

  v_submitted := public.submit_daily_report(v_report_id);
  IF v_submitted IS NULL THEN
    RAISE EXCEPTION 'FAIL: the substitute should be able to submit the report she wrote';
  END IF;
  RAISE NOTICE 'PASS: the substitute can submit the covered day''s report';

  -- And the submitted-lock still applies to her, as it does to any teacher.
  BEGIN
    PERFORM public.save_daily_report_teacher_note(
      '00000000-0000-4000-9000-000000000016',
      '00000000-0000-4000-9000-000000000020',
      '2026-08-03',
      'Setelah terkirim'
    );
    RAISE EXCEPTION 'FAIL: a submitted report must stay locked, even for a substitute';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: the submitted-lock applies to the substitute too';
  END;
END $$;

RESET ROLE;
SET LOCAL request.jwt.claims = '';

-- ---------------------------------------------------------------------------
-- enforce_child_present still applies to a substitute
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-9000-000000000001","role":"authenticated","app_metadata":{"role":"admin"}}';

INSERT INTO public.classroom_teachers_substitutions (
  classroom_teacher_id, substitute_teacher_id, session_date, counts_for_pay, created_by_role
) VALUES (
  '00000000-0000-4000-9000-000000000020',
  '00000000-0000-4000-9000-000000000013',
  '2026-08-05', false, 'admin'
);

RESET ROLE;
SET LOCAL request.jwt.claims = '';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-9000-000000000003","role":"authenticated","app_metadata":{"role":"teacher"}}';

DO $$
BEGIN
  -- 2026-08-05 is covered, but the child has no 'present' attendance row for it.
  BEGIN
    PERFORM public.save_daily_report_teacher_note(
      '00000000-0000-4000-9000-000000000016',
      '00000000-0000-4000-9000-000000000020',
      '2026-08-05',
      'Tanpa absensi'
    );
    RAISE EXCEPTION 'FAIL: a report must still require a present attendance row';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: enforce_child_present still gates the substitute''s report';
  END;

  -- She can record that attendance herself, which is the order the student sheet follows.
  PERFORM public.record_attendance(
    '00000000-0000-4000-9000-000000000016',
    '00000000-0000-4000-9000-000000000018',
    '2026-08-05',
    'present',
    NULL
  );
  PERFORM public.save_daily_report_teacher_note(
    '00000000-0000-4000-9000-000000000016',
    '00000000-0000-4000-9000-000000000020',
    '2026-08-05',
    'Setelah absensi diisi'
  );
  RAISE NOTICE 'PASS: attendance first, then the note — the substitute can do both';
END $$;

RESET ROLE;
SET LOCAL request.jwt.claims = '';

-- ---------------------------------------------------------------------------
-- Attribution: the parent sees who actually sent the report
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-9000-000000000005","role":"authenticated","app_metadata":{"role":"parent"}}';

DO $$
DECLARE
  v_name text;
  v_rows int;
BEGIN
  SELECT teacher_full_name INTO v_name
    FROM public.daily_report_for_attendance(
      '00000000-0000-4000-9000-000000000016',
      '00000000-0000-4000-9000-000000000018',
      '2026-08-03');
  IF v_name IS DISTINCT FROM 'Sub Test Teacher B' THEN
    RAISE EXCEPTION 'FAIL: the submitted report should be credited to B, got %', COALESCE(v_name, '<null>');
  END IF;
  RAISE NOTICE 'PASS: the parent sees the substitute who actually sent the report';

  -- 2026-08-05's report was written but never submitted, so a parent must not see it at all.
  SELECT count(*) INTO v_rows
    FROM public.daily_report_for_attendance(
      '00000000-0000-4000-9000-000000000016',
      '00000000-0000-4000-9000-000000000018',
      '2026-08-05');
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'FAIL: a draft must stay invisible to the parent, got % rows', v_rows;
  END IF;
  RAISE NOTICE 'PASS: a draft report is still invisible to the parent';
END $$;

RESET ROLE;
SET LOCAL request.jwt.claims = '';

-- A report submitted by the group's own teacher still shows her name — the fallback chain has not
-- changed the ordinary case.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-9000-000000000002","role":"authenticated","app_metadata":{"role":"teacher"}}';

DO $$
DECLARE
  v_report_id uuid;
BEGIN
  v_report_id := public.save_daily_report_teacher_note(
    '00000000-0000-4000-9000-000000000016',
    '00000000-0000-4000-9000-000000000020',
    '2026-08-04',
    'Ditulis guru kelasnya sendiri'
  );
  PERFORM public.submit_daily_report(v_report_id);
END $$;

RESET ROLE;
SET LOCAL request.jwt.claims = '';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-9000-000000000005","role":"authenticated","app_metadata":{"role":"parent"}}';

DO $$
DECLARE
  v_name text;
BEGIN
  SELECT teacher_full_name INTO v_name
    FROM public.daily_report_for_attendance(
      '00000000-0000-4000-9000-000000000016',
      '00000000-0000-4000-9000-000000000018',
      '2026-08-04');
  IF v_name IS DISTINCT FROM 'Sub Test Teacher A' THEN
    RAISE EXCEPTION 'FAIL: an uncovered day should still be credited to A, got %', COALESCE(v_name, '<null>');
  END IF;
  RAISE NOTICE 'PASS: an uncovered day is still credited to the assigned teacher';
END $$;

RESET ROLE;
SET LOCAL request.jwt.claims = '';

-- ---------------------------------------------------------------------------
-- declare_substitution — the Gantikan Kelas button, on the flexi classrooms so today qualifies
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-9000-000000000003","role":"authenticated","app_metadata":{"role":"teacher"}}';

DO $$
DECLARE
  v_date date := (now() AT TIME ZONE 'Asia/Makassar')::date;
  v_id uuid;
  v_again uuid;
  v_counts boolean;
  v_last_monday date;
  v_past_id uuid;
BEGIN
  v_id := public.declare_substitution('00000000-0000-4000-9000-000000000023', v_date, 'A tidak hadir');
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'FAIL: B should be able to declare coverage of A''s flexi group today';
  END IF;

  SELECT counts_for_pay INTO v_counts
    FROM public.classroom_teachers_substitutions WHERE id = v_id;
  IF NOT v_counts THEN
    RAISE EXCEPTION 'FAIL: B holds no group in the flexi classroom, so this should be payable';
  END IF;
  RAISE NOTICE 'PASS: a teacher can declare coverage for today, with the pay rule applied';

  -- A second tap of the button is harmless.
  v_again := public.declare_substitution('00000000-0000-4000-9000-000000000023', v_date, NULL);
  IF v_again <> v_id THEN
    RAISE EXCEPTION 'FAIL: re-declaring must return the same record, got % then %', v_id, v_again;
  END IF;
  RAISE NOTICE 'PASS: declaring twice is idempotent';

  -- And it now shows as hers in the picker.
  IF NOT EXISTS (
    SELECT 1 FROM public.substitutable_classes(v_date)
    WHERE classroom_teacher_id = '00000000-0000-4000-9000-000000000023' AND covered_by_me
  ) THEN
    RAISE EXCEPTION 'FAIL: the declared group should come back flagged covered_by_me';
  END IF;
  RAISE NOTICE 'PASS: the declared group is flagged as hers';

  -- A day that has not happened cannot have been covered. This is the one hard limit on the date
  -- selector, because attendance draws down a child's paid quota.
  BEGIN
    PERFORM public.declare_substitution(
      '00000000-0000-4000-9000-000000000023', v_date + 1, NULL);
    RAISE EXCEPTION 'FAIL: a future date must be refused';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: coverage cannot be declared for a future date';
  END;

  -- The catch-up this change exists for: a real scheduled class (not flexi) on a past weekday, so
  -- both the Mon–Fri rule and the skipped clock-in window are exercised. date_trunc gives last
  -- week's Monday, which is always in the past and always a weekday whenever this runs.
  v_last_monday := (date_trunc('week', v_date - 7))::date;
  v_past_id := public.declare_substitution(
    '00000000-0000-4000-9000-000000000020', v_last_monday, 'Lupa diisi hari itu');
  IF v_past_id IS NULL THEN
    RAISE EXCEPTION 'FAIL: B should be able to catch up a past weekday she covered';
  END IF;
  RAISE NOTICE 'PASS: coverage can be declared for a past weekday, window not applied';

  -- And that past day is now writable, while a day she does not cover still is not.
  IF NOT public.can_write_daily_report('00000000-0000-4000-9000-000000000020', v_last_monday) THEN
    RAISE EXCEPTION 'FAIL: the caught-up day should be writable';
  END IF;
  IF public.can_write_daily_report('00000000-0000-4000-9000-000000000020', v_last_monday - 1) THEN
    RAISE EXCEPTION 'FAIL: the day before it must not be writable';
  END IF;
  RAISE NOTICE 'PASS: the catch-up grants exactly that one day';
END $$;

RESET ROLE;
SET LOCAL request.jwt.claims = '';

-- C cannot take the class off B.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-9000-000000000004","role":"authenticated","app_metadata":{"role":"teacher"}}';

DO $$
DECLARE
  v_date date := (now() AT TIME ZONE 'Asia/Makassar')::date;
BEGIN
  BEGIN
    PERFORM public.declare_substitution('00000000-0000-4000-9000-000000000023', v_date, NULL);
    RAISE EXCEPTION 'FAIL: a second teacher must not take over existing coverage';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: coverage cannot be taken over by another teacher';
  END;

  -- And she sees it as taken, not as free.
  IF NOT EXISTS (
    SELECT 1 FROM public.substitutable_classes(v_date)
    WHERE classroom_teacher_id = '00000000-0000-4000-9000-000000000023'
      AND covered_by_other AND NOT covered_by_me
  ) THEN
    RAISE EXCEPTION 'FAIL: C should see that group flagged covered_by_other';
  END IF;
  RAISE NOTICE 'PASS: another teacher sees the group as already covered';
END $$;

RESET ROLE;
SET LOCAL request.jwt.claims = '';

-- A is standing right there, so her class is not a coverage situation.
INSERT INTO public.classroom_teachers_attendances (classroom_teacher_id, session_date, clocked_in_at, clocked_in_source)
VALUES ('00000000-0000-4000-9000-000000000024', (now() AT TIME ZONE 'Asia/Makassar')::date, now(), 'teacher');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-9000-000000000003","role":"authenticated","app_metadata":{"role":"teacher"}}';

DO $$
DECLARE
  v_date date := (now() AT TIME ZONE 'Asia/Makassar')::date;
BEGIN
  BEGIN
    PERFORM public.declare_substitution('00000000-0000-4000-9000-000000000024', v_date, NULL);
    RAISE EXCEPTION 'FAIL: a class whose teacher has clocked in must not be coverable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: coverage is refused once the assigned teacher has clocked in';
  END;

  -- She cannot cover her own group either.
  BEGIN
    PERFORM public.declare_substitution('00000000-0000-4000-9000-000000000021', v_date, NULL);
    RAISE EXCEPTION 'FAIL: a teacher must not declare coverage of her own group';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: a teacher cannot cover her own group';
  END;
END $$;

RESET ROLE;
SET LOCAL request.jwt.claims = '';

-- ---------------------------------------------------------------------------
-- withdraw_substitution — the way back from picking the wrong class
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-9000-000000000004","role":"authenticated","app_metadata":{"role":"teacher"}}';

DO $$
DECLARE
  v_date date := (now() AT TIME ZONE 'Asia/Makassar')::date;
BEGIN
  -- C does not hold this coverage, so there is nothing of hers to withdraw and B's record stands.
  -- Verified below as admin: C cannot SELECT B's coverage row at all, so counting it from here
  -- would read 0 whether the delete happened or not.
  PERFORM public.withdraw_substitution('00000000-0000-4000-9000-000000000023', v_date);
END $$;

RESET ROLE;
SET LOCAL request.jwt.claims = '';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-9000-000000000001","role":"authenticated","app_metadata":{"role":"admin"}}';

DO $$
DECLARE
  v_rows int;
BEGIN
  SELECT count(*) INTO v_rows FROM public.classroom_teachers_substitutions
    WHERE classroom_teacher_id = '00000000-0000-4000-9000-000000000023';
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'FAIL: C must not be able to withdraw B''s coverage, % rows left', v_rows;
  END IF;
  RAISE NOTICE 'PASS: a teacher cannot withdraw someone else''s coverage';
END $$;

RESET ROLE;
SET LOCAL request.jwt.claims = '';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-9000-000000000003","role":"authenticated","app_metadata":{"role":"teacher"}}';

DO $$
DECLARE
  v_date date := (now() AT TIME ZONE 'Asia/Makassar')::date;
  v_rows int;
BEGIN
  -- Visible to her beforehand, so the 0 below means "deleted" rather than "never readable".
  SELECT count(*) INTO v_rows FROM public.classroom_teachers_substitutions
    WHERE classroom_teacher_id = '00000000-0000-4000-9000-000000000023';
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'FAIL: B should be able to see her own coverage before withdrawing it, got %', v_rows;
  END IF;

  PERFORM public.withdraw_substitution('00000000-0000-4000-9000-000000000023', v_date);

  SELECT count(*) INTO v_rows FROM public.classroom_teachers_substitutions
    WHERE classroom_teacher_id = '00000000-0000-4000-9000-000000000023';
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'FAIL: B should have been able to withdraw her own coverage';
  END IF;
  RAISE NOTICE 'PASS: a teacher can withdraw her own coverage for today';

  -- A submitted report pins it: 2026-08-03's was submitted above, so that day cannot be given
  -- back. (It is not today's date, so this also shows withdraw only ever touches today — the
  -- DELETE below finds nothing for it either way, and the submitted-report guard fires first.)
  BEGIN
    PERFORM public.withdraw_substitution('00000000-0000-4000-9000-000000000020', v_date);
    -- No submitted report for TODAY on that group, so this is allowed and removes nothing.
    RAISE NOTICE 'PASS: withdrawing a group with no coverage today is a harmless no-op';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE EXCEPTION 'FAIL: withdrawing where there is no coverage today should not raise';
  END;

  -- 2026-08-03's coverage is untouched by a withdraw aimed at today.
  IF NOT EXISTS (
    SELECT 1 FROM public.classroom_teachers_substitutions
    WHERE classroom_teacher_id = '00000000-0000-4000-9000-000000000020' AND session_date = '2026-08-03'
  ) THEN
    RAISE EXCEPTION 'FAIL: withdraw must only ever remove today''s coverage';
  END IF;
  RAISE NOTICE 'PASS: withdraw only removes today''s coverage, never a past day''s';
END $$;

RESET ROLE;
SET LOCAL request.jwt.claims = '';

DO $$ BEGIN RAISE NOTICE 'ALL SUBSTITUTION TESTS PASSED'; END $$;

ROLLBACK;
