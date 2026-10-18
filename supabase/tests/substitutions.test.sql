-- Tests for guru pengganti: the classroom_teachers_substitutions table and its trigger, the
-- date-aware write gates, the substitute's read policies, declare/assign/cancel, and the author
-- attribution in daily_report_for_attendance (migrations 20261018010000, 20261018020000,
-- 20261018030000, 20261018040000).
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
-- The classrooms used by the declare_substitution cases are is_flexi_hours, which is what makes
-- those tests deterministic: declare_substitution reads today's WITA date itself and applies the
-- Mon–Fri and "an hour before the class starts" rules, neither of which a fixed fixture date can
-- satisfy on every day the suite might be run. A flexi classroom skips both by design, leaving the
-- rules this script actually wants to pin: takeover, self-substitution and the clocked-in guard.

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

-- g_a and g_b are two groups of the SAME classroom; g_c is C's group elsewhere.
INSERT INTO public.classroom_teachers (id, classroom_id, teacher_id) VALUES
  ('00000000-0000-4000-9000-000000000020', '00000000-0000-4000-9000-000000000018', '00000000-0000-4000-9000-000000000012'),
  ('00000000-0000-4000-9000-000000000021', '00000000-0000-4000-9000-000000000018', '00000000-0000-4000-9000-000000000013'),
  ('00000000-0000-4000-9000-000000000022', '00000000-0000-4000-9000-000000000019', '00000000-0000-4000-9000-000000000014'),
  ('00000000-0000-4000-9000-000000000023', '00000000-0000-4000-9000-00000000001a', '00000000-0000-4000-9000-000000000012'),
  ('00000000-0000-4000-9000-000000000024', '00000000-0000-4000-9000-00000000001b', '00000000-0000-4000-9000-000000000012');

-- The child is in A's group, in A's classroom and in both flexi programs.
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
-- assign_substitution is admin-only
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-9000-000000000003","role":"authenticated","app_metadata":{"role":"teacher"}}';

DO $$
BEGIN
  BEGIN
    PERFORM public.assign_substitution(
      '00000000-0000-4000-9000-000000000020',
      '00000000-0000-4000-9000-000000000013',
      '2026-08-03',
      NULL,
      NULL
    );
    RAISE EXCEPTION 'FAIL: a teacher must not be able to assign coverage for an arbitrary date';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: assign_substitution is admin-only';
  END;
END $$;

RESET ROLE;
SET LOCAL request.jwt.claims = '';

-- ---------------------------------------------------------------------------
-- Admin assigns B to cover A's group on 2026-08-03
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-9000-000000000001","role":"authenticated","app_metadata":{"role":"admin"}}';

DO $$
DECLARE
  v_id uuid;
  v_counts boolean;
BEGIN
  v_id := public.assign_substitution(
    '00000000-0000-4000-9000-000000000020',
    '00000000-0000-4000-9000-000000000013',
    '2026-08-03',
    NULL,
    'Izin sakit'
  );

  SELECT counts_for_pay INTO v_counts
    FROM public.classroom_teachers_substitutions WHERE id = v_id;
  IF v_counts THEN
    RAISE EXCEPTION 'FAIL: NULL p_counts_for_pay should have taken the unpaid default for B';
  END IF;
  RAISE NOTICE 'PASS: admin assignment derives counts_for_pay when not told';

  -- Self-substitution: A cannot stand in for her own group.
  BEGIN
    PERFORM public.assign_substitution(
      '00000000-0000-4000-9000-000000000023',
      '00000000-0000-4000-9000-000000000012',
      '2026-08-03',
      NULL,
      NULL
    );
    RAISE EXCEPTION 'FAIL: a teacher must not be her own substitute';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: self-substitution is refused';
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
  -- Reads first: the roster is what was empty before.
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
    RAISE EXCEPTION 'FAIL: B should now see the covered group row (the class dropdown needs it)';
  END IF;
  RAISE NOTICE 'PASS: coverage opens the roster, the child and the group row';

  -- Note what is NOT asserted here: B sees this classroom's attendance on every date, covered or
  -- not, because she is assigned to the classroom and teacher_select_child_attendances is
  -- classroom-scoped (20260803010000:176-177). That predates this feature. The date correlation of
  -- the new substitute policy is pinned further down with teacher C, who has no assignment in this
  -- classroom and so no pre-existing access to hide behind.
  SELECT count(*) INTO v_rows FROM public.child_attendances
    WHERE child_id = '00000000-0000-4000-9000-000000000016' AND attendance_date = '2026-08-03';
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'FAIL: B should see the covered day''s attendance';
  END IF;

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

  -- A substitute has read access to the group, but RLS must not hand her a direct table write
  -- that skips the gate. This is the hole that widening the shared helpers would have opened.
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

DO $$
BEGIN
  PERFORM public.assign_substitution(
    '00000000-0000-4000-9000-000000000020',
    '00000000-0000-4000-9000-000000000013',
    '2026-08-05',
    NULL,
    NULL
  );
END $$;

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

  -- She can record that attendance herself, which is the ordering the UI follows.
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
-- declare_substitution — on the flexi classrooms, so today's date always qualifies
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-9000-000000000003","role":"authenticated","app_metadata":{"role":"teacher"}}';

DO $$
DECLARE
  v_id uuid;
  v_again uuid;
BEGIN
  v_id := public.declare_substitution('00000000-0000-4000-9000-000000000023', 'A tidak hadir');
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'FAIL: B should be able to declare coverage of A''s flexi group today';
  END IF;
  RAISE NOTICE 'PASS: a teacher can declare coverage for today';

  -- A second tap is harmless.
  v_again := public.declare_substitution('00000000-0000-4000-9000-000000000023', NULL);
  IF v_again <> v_id THEN
    RAISE EXCEPTION 'FAIL: re-declaring must return the same record, got % then %', v_id, v_again;
  END IF;
  RAISE NOTICE 'PASS: declaring twice is idempotent';
END $$;

RESET ROLE;
SET LOCAL request.jwt.claims = '';

-- C cannot take the class off B.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-9000-000000000004","role":"authenticated","app_metadata":{"role":"teacher"}}';

DO $$
BEGIN
  BEGIN
    PERFORM public.declare_substitution('00000000-0000-4000-9000-000000000023', NULL);
    RAISE EXCEPTION 'FAIL: a second teacher must not take over existing coverage';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: coverage cannot be taken over by another teacher';
  END;
END $$;

RESET ROLE;
SET LOCAL request.jwt.claims = '';

-- A is standing right there, so her class is not a coverage situation.
INSERT INTO public.classroom_teachers_attendances (classroom_teacher_id, session_date, clocked_in_at, clocked_in_source)
VALUES ('00000000-0000-4000-9000-000000000024', (now() AT TIME ZONE 'Asia/Makassar')::date, now(), 'teacher');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-9000-000000000003","role":"authenticated","app_metadata":{"role":"teacher"}}';

DO $$
BEGIN
  BEGIN
    PERFORM public.declare_substitution('00000000-0000-4000-9000-000000000024', NULL);
    RAISE EXCEPTION 'FAIL: a class whose teacher has clocked in must not be coverable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: coverage is refused once the assigned teacher has clocked in';
  END;

  -- And she cannot cover her own group, whatever the route in.
  BEGIN
    PERFORM public.declare_substitution('00000000-0000-4000-9000-000000000021', NULL);
    RAISE EXCEPTION 'FAIL: a teacher must not declare coverage of her own group';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: a teacher cannot cover her own group';
  END;
END $$;

RESET ROLE;
SET LOCAL request.jwt.claims = '';

-- ---------------------------------------------------------------------------
-- cancel_substitution
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-9000-000000000003","role":"authenticated","app_metadata":{"role":"teacher"}}';

DO $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.classroom_teachers_substitutions
    WHERE classroom_teacher_id = '00000000-0000-4000-9000-000000000020' AND session_date = '2026-08-03';

  BEGIN
    PERFORM public.cancel_substitution(v_id);
    RAISE EXCEPTION 'FAIL: a teacher must not be able to cancel a coverage record';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: cancel_substitution is admin-only';
  END;
END $$;

RESET ROLE;
SET LOCAL request.jwt.claims = '';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-9000-000000000001","role":"authenticated","app_metadata":{"role":"admin"}}';

DO $$
DECLARE
  v_id uuid;
  v_rows int;
BEGIN
  SELECT id INTO v_id FROM public.classroom_teachers_substitutions
    WHERE classroom_teacher_id = '00000000-0000-4000-9000-000000000020' AND session_date = '2026-08-03';

  PERFORM public.cancel_substitution(v_id);

  SELECT count(*) INTO v_rows FROM public.classroom_teachers_substitutions WHERE id = v_id;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'FAIL: the coverage record should be gone';
  END IF;
  RAISE NOTICE 'PASS: an admin can cancel coverage';

  -- The 08-05 record has to go too before the access check below means anything: the roster-level
  -- read helpers are date-agnostic (see 20261018010000's header), so ANY coverage of this group
  -- keeps the roster visible. That is the intended design, and this is what pins it.
  SELECT id INTO v_id FROM public.classroom_teachers_substitutions
    WHERE classroom_teacher_id = '00000000-0000-4000-9000-000000000020' AND session_date = '2026-08-05';
  PERFORM public.cancel_substitution(v_id);

  -- What she already wrote stays — cancelling withdraws access, it does not undo the work.
  IF NOT EXISTS (
    SELECT 1 FROM public.children_daily_reports
    WHERE classroom_teacher_id = '00000000-0000-4000-9000-000000000020' AND report_date = '2026-08-03'
  ) THEN
    RAISE EXCEPTION 'FAIL: cancelling coverage must not delete the report that was written';
  END IF;
  RAISE NOTICE 'PASS: cancelling coverage leaves the filled report intact';
END $$;

RESET ROLE;
SET LOCAL request.jwt.claims = '';

-- Access really is withdrawn with the record.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-9000-000000000003","role":"authenticated","app_metadata":{"role":"teacher"}}';

DO $$
DECLARE
  v_rows int;
BEGIN
  SELECT count(*) INTO v_rows FROM public.children_classrooms
    WHERE classroom_teacher_id = '00000000-0000-4000-9000-000000000020';
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'FAIL: B should no longer see A''s roster for 08-03, got % rows', v_rows;
  END IF;
  RAISE NOTICE 'PASS: cancelling coverage withdraws the read access it granted';
END $$;

RESET ROLE;
SET LOCAL request.jwt.claims = '';

-- ---------------------------------------------------------------------------
-- Date correlation of the new attendance policy, with a teacher who has no assignment in this
-- classroom — so what she can see comes from the coverage record and nothing else.
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-9000-000000000001","role":"authenticated","app_metadata":{"role":"admin"}}';

DO $$
DECLARE
  v_counts boolean;
  v_id uuid;
BEGIN
  v_id := public.assign_substitution(
    '00000000-0000-4000-9000-000000000020',
    '00000000-0000-4000-9000-000000000014',
    '2026-08-03',
    NULL,
    NULL
  );

  SELECT counts_for_pay INTO v_counts
    FROM public.classroom_teachers_substitutions WHERE id = v_id;
  IF NOT v_counts THEN
    RAISE EXCEPTION 'FAIL: C comes in from outside, so this coverage should default to payable';
  END IF;
  RAISE NOTICE 'PASS: an outside substitute is recorded as payable';
END $$;

RESET ROLE;
SET LOCAL request.jwt.claims = '';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-9000-000000000004","role":"authenticated","app_metadata":{"role":"teacher"}}';

DO $$
DECLARE
  v_rows int;
BEGIN
  SELECT count(*) INTO v_rows FROM public.child_attendances
    WHERE child_id = '00000000-0000-4000-9000-000000000016' AND attendance_date = '2026-08-03';
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'FAIL: C should see the covered day''s attendance, got % rows', v_rows;
  END IF;

  SELECT count(*) INTO v_rows FROM public.child_attendances
    WHERE child_id = '00000000-0000-4000-9000-000000000016' AND attendance_date = '2026-08-04';
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'FAIL: C must not see an uncovered day''s attendance, got % rows', v_rows;
  END IF;
  RAISE NOTICE 'PASS: the substitute''s attendance reads are scoped to the covered date';

  -- Same for the reports: the covered day only.
  SELECT count(*) INTO v_rows FROM public.children_daily_reports
    WHERE classroom_teacher_id = '00000000-0000-4000-9000-000000000020' AND report_date = '2026-08-04';
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'FAIL: C must not see an uncovered day''s report, got % rows', v_rows;
  END IF;

  SELECT count(*) INTO v_rows FROM public.children_daily_reports
    WHERE classroom_teacher_id = '00000000-0000-4000-9000-000000000020' AND report_date = '2026-08-03';
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'FAIL: C should see the covered day''s report, got % rows', v_rows;
  END IF;
  RAISE NOTICE 'PASS: the substitute''s report reads are scoped to the covered date';
END $$;

RESET ROLE;
SET LOCAL request.jwt.claims = '';

DO $$ BEGIN RAISE NOTICE 'ALL SUBSTITUTION TESTS PASSED'; END $$;

ROLLBACK;
