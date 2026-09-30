-- Tests for save_daily_report_items / save_daily_report_mood / submit_daily_report and the
-- daily-report RLS policies (migrations 20260802010000_daily_reports_curriculum.sql,
-- 20260930010000_children_daily_reports.sql, 20261001010000_daily_report_per_class_present_only.sql).
--
-- Everything runs inside one transaction that ends in ROLLBACK, so it is safe to run against
-- the live project: no fixture survives the script. It creates its own auth.users rows and
-- impersonates them with `SET LOCAL ROLE authenticated` + `request.jwt.claims`, which is what
-- auth.uid() and auth.jwt() read.
--
-- Run with either:
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/daily_reports.test.sql
--   ...or paste it into the SQL editor / the Supabase MCP execute_sql tool.
--
-- Every assertion RAISEs on failure, so any output containing 'FAIL' — or an aborted run —
-- means a broken test. A clean run ends with 'ALL DAILY REPORT TESTS PASSED'.

BEGIN;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_app_meta_data, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'test-admin@example.test',   '{"role":"admin"}',   now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'test-teacher-a@example.test', '{"role":"teacher"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'test-teacher-b@example.test', '{"role":"teacher"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'test-parent-1@example.test',  '{"role":"parent"}',  now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'test-parent-2@example.test',  '{"role":"parent"}',  now(), now());

INSERT INTO public.teachers (id, full_name, email, auth_user_id) VALUES
  ('00000000-0000-4000-8000-000000000012', 'Test Teacher A', 'test-teacher-a@example.test', '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000013', 'Test Teacher B', 'test-teacher-b@example.test', '00000000-0000-4000-8000-000000000003');

INSERT INTO public.families (id, login_email, auth_user_id) VALUES
  ('00000000-0000-4000-8000-000000000014', 'test-parent-1@example.test', '00000000-0000-4000-8000-000000000004'),
  ('00000000-0000-4000-8000-000000000015', 'test-parent-2@example.test', '00000000-0000-4000-8000-000000000005');

INSERT INTO public.children (id, family_id, full_name) VALUES
  ('00000000-0000-4000-8000-000000000016', '00000000-0000-4000-8000-000000000014', 'Test Child One'),
  ('00000000-0000-4000-8000-000000000017', '00000000-0000-4000-8000-000000000015', 'Test Child Two');

-- Test Classroom 2 is a second, separately billed program — Child One attends both on the same
-- day, which is the case the per-class report key exists for.
INSERT INTO public.classrooms (id, label, time_start, time_end, price) VALUES
  ('00000000-0000-4000-8000-000000000018', 'Test Classroom', '10:00', '12:00', 0),
  ('00000000-0000-4000-8000-000000000030', 'Test Classroom 2', '15:30', '17:30', 0);

INSERT INTO public.classroom_teachers (id, classroom_id, teacher_id) VALUES
  ('00000000-0000-4000-8000-000000000019', '00000000-0000-4000-8000-000000000018', '00000000-0000-4000-8000-000000000012'),
  ('00000000-0000-4000-8000-00000000001a', '00000000-0000-4000-8000-000000000018', '00000000-0000-4000-8000-000000000013'),
  ('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000012');

-- Child One is in Teacher A's group in both programs, Child Two in Teacher B's.
INSERT INTO public.children_classrooms (child_id, classroom_teacher_id, started_at) VALUES
  ('00000000-0000-4000-8000-000000000016', '00000000-0000-4000-8000-000000000019', '2026-01-01'),
  ('00000000-0000-4000-8000-000000000016', '00000000-0000-4000-8000-000000000031', '2026-01-01'),
  ('00000000-0000-4000-8000-000000000017', '00000000-0000-4000-8000-00000000001a', '2026-01-01');

-- A report can only exist for a child recorded present (enforce_child_present), and attendance
-- hangs off a learning period, so each (child, program) needs a period before it can have either.
INSERT INTO public.learning_periods (id, child_id, classroom_id, period_no, start_date) VALUES
  ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000016', '00000000-0000-4000-8000-000000000018', 1, '2026-01-01'),
  ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000016', '00000000-0000-4000-8000-000000000030', 1, '2026-01-01');

-- 2026-08-03: Child One present in both programs. 2026-08-04: absent from Test Classroom.
INSERT INTO public.child_attendances (learning_period_id, child_id, classroom_id, attendance_date, status) VALUES
  ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000016', '00000000-0000-4000-8000-000000000018', '2026-08-03', 'present'),
  ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000016', '00000000-0000-4000-8000-000000000030', '2026-08-03', 'present'),
  ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000016', '00000000-0000-4000-8000-000000000018', '2026-08-04', 'absent');

INSERT INTO public.curriculum_items (id, subject, label, sort_order) VALUES
  ('00000000-0000-4000-8000-000000000020', 'literasi', 'TEST Materi Literasi 1', 1),
  ('00000000-0000-4000-8000-000000000021', 'literasi', 'TEST Materi Literasi 2', 2),
  ('00000000-0000-4000-8000-000000000022', 'numerasi', 'TEST Materi Numerasi 1', 3);

-- ---------------------------------------------------------------------------
-- save_daily_report_items — as Teacher A
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"role":"teacher"}}';

DO $$
DECLARE
  v_report_id uuid;
  v_second_id uuid;
  v_reports int;
  v_items int;
BEGIN
  v_report_id := public.save_daily_report_items(
    '00000000-0000-4000-8000-000000000016',
    '00000000-0000-4000-8000-000000000019',
    '2026-08-03',
    '[{"curriculum_item_id":"00000000-0000-4000-8000-000000000020","mastery_level":3},
      {"curriculum_item_id":"00000000-0000-4000-8000-000000000022","mastery_level":5}]'::jsonb
  );

  SELECT count(*) INTO v_items FROM public.daily_report_items WHERE report_id = v_report_id;
  IF v_items <> 2 THEN
    RAISE EXCEPTION 'FAIL: first save should write 2 entries, got %', v_items;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.children_daily_reports WHERE id = v_report_id AND submitted_at IS NULL) THEN
    RAISE EXCEPTION 'FAIL: a freshly saved report must be a draft (submitted_at NULL)';
  END IF;
  RAISE NOTICE 'PASS: save creates a draft report with its entries';

  -- Idempotency: same payload again must not duplicate anything or move the report.
  v_second_id := public.save_daily_report_items(
    '00000000-0000-4000-8000-000000000016',
    '00000000-0000-4000-8000-000000000019',
    '2026-08-03',
    '[{"curriculum_item_id":"00000000-0000-4000-8000-000000000020","mastery_level":3},
      {"curriculum_item_id":"00000000-0000-4000-8000-000000000022","mastery_level":5}]'::jsonb
  );

  IF v_second_id <> v_report_id THEN
    RAISE EXCEPTION 'FAIL: re-saving must reuse the same report row, got % then %', v_report_id, v_second_id;
  END IF;

  SELECT count(*) INTO v_reports FROM public.children_daily_reports
    WHERE child_id = '00000000-0000-4000-8000-000000000016' AND report_date = '2026-08-03';
  SELECT count(*) INTO v_items FROM public.daily_report_items WHERE report_id = v_report_id;
  IF v_reports <> 1 OR v_items <> 2 THEN
    RAISE EXCEPTION 'FAIL: re-saving is not idempotent (% reports, % entries)', v_reports, v_items;
  END IF;
  RAISE NOTICE 'PASS: saving the same payload twice is idempotent';

  -- Replace semantics: item 20 keeps a new level, 22 disappears, 21 appears.
  PERFORM public.save_daily_report_items(
    '00000000-0000-4000-8000-000000000016',
    '00000000-0000-4000-8000-000000000019',
    '2026-08-03',
    '[{"curriculum_item_id":"00000000-0000-4000-8000-000000000020","mastery_level":1},
      {"curriculum_item_id":"00000000-0000-4000-8000-000000000021","mastery_level":4}]'::jsonb
  );

  IF EXISTS (
    SELECT 1 FROM public.daily_report_items
    WHERE report_id = v_report_id AND curriculum_item_id = '00000000-0000-4000-8000-000000000022'
  ) THEN
    RAISE EXCEPTION 'FAIL: entries omitted from the payload must be deleted, not merged';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.daily_report_items
    WHERE report_id = v_report_id AND curriculum_item_id = '00000000-0000-4000-8000-000000000020' AND mastery_level = 1
  ) THEN
    RAISE EXCEPTION 'FAIL: an existing entry must have its mastery_level updated in place';
  END IF;

  SELECT count(*) INTO v_items FROM public.daily_report_items WHERE report_id = v_report_id;
  IF v_items <> 2 THEN
    RAISE EXCEPTION 'FAIL: replace should leave exactly 2 entries, got %', v_items;
  END IF;
  RAISE NOTICE 'PASS: save replaces the entry set rather than merging into it';

  -- An empty payload clears the section but keeps the report row.
  PERFORM public.save_daily_report_items(
    '00000000-0000-4000-8000-000000000016',
    '00000000-0000-4000-8000-000000000019',
    '2026-08-03',
    '[]'::jsonb
  );
  SELECT count(*) INTO v_items FROM public.daily_report_items WHERE report_id = v_report_id;
  IF v_items <> 0 THEN
    RAISE EXCEPTION 'FAIL: an empty payload should clear all entries, % left', v_items;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.children_daily_reports WHERE id = v_report_id) THEN
    RAISE EXCEPTION 'FAIL: clearing entries must not delete the report row';
  END IF;
  RAISE NOTICE 'PASS: an empty payload clears the section and keeps the report';

  -- Restore a real payload for the RLS tests below.
  PERFORM public.save_daily_report_items(
    '00000000-0000-4000-8000-000000000016',
    '00000000-0000-4000-8000-000000000019',
    '2026-08-03',
    '[{"curriculum_item_id":"00000000-0000-4000-8000-000000000020","mastery_level":3}]'::jsonb
  );
END $$;

-- Rejections: duplicate ids, out-of-range level, child not in that class.
DO $$
BEGIN
  BEGIN
    PERFORM public.save_daily_report_items(
      '00000000-0000-4000-8000-000000000016',
      '00000000-0000-4000-8000-000000000019',
      '2026-08-03',
      '[{"curriculum_item_id":"00000000-0000-4000-8000-000000000020","mastery_level":2},
        {"curriculum_item_id":"00000000-0000-4000-8000-000000000020","mastery_level":4}]'::jsonb
    );
    RAISE EXCEPTION 'FAIL: duplicate curriculum_item_id in the payload must be rejected';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: duplicate entries rejected (%)', SQLERRM;
  END;

  BEGIN
    PERFORM public.save_daily_report_items(
      '00000000-0000-4000-8000-000000000016',
      '00000000-0000-4000-8000-000000000019',
      '2026-08-03',
      '[{"curriculum_item_id":"00000000-0000-4000-8000-000000000020","mastery_level":6}]'::jsonb
    );
    RAISE EXCEPTION 'FAIL: mastery_level 6 must violate the 1..5 CHECK';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: mastery_level outside 1..5 rejected (%)', SQLERRM;
  END;

  BEGIN
    -- Child Two belongs to Teacher B's group, not this one.
    PERFORM public.save_daily_report_items(
      '00000000-0000-4000-8000-000000000017',
      '00000000-0000-4000-8000-000000000019',
      '2026-08-03',
      '[{"curriculum_item_id":"00000000-0000-4000-8000-000000000020","mastery_level":3}]'::jsonb
    );
    RAISE EXCEPTION 'FAIL: writing a report for a child not enrolled in that class must be rejected';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: unenrolled child rejected (%)', SQLERRM;
  END;

  -- Present-only: Child One is enrolled on 2026-08-04 but recorded absent.
  BEGIN
    PERFORM public.save_daily_report_mood(
      '00000000-0000-4000-8000-000000000016',
      '00000000-0000-4000-8000-000000000019',
      '2026-08-04',
      p_mood_arrival => 'senang'
    );
    RAISE EXCEPTION 'FAIL: a report for an absent child must be rejected';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE 'Laporan harian hanya%' THEN
      RAISE EXCEPTION 'FAIL: rejected for the wrong reason: %', SQLERRM;
    END IF;
    RAISE NOTICE 'PASS: absent child rejected (%)', SQLERRM;
  END;

  -- Present-only: no attendance row at all (the class didn't run) is not "present" either.
  BEGIN
    PERFORM public.save_daily_report_mood(
      '00000000-0000-4000-8000-000000000016',
      '00000000-0000-4000-8000-000000000019',
      '2026-08-05',
      p_mood_arrival => 'senang'
    );
    RAISE EXCEPTION 'FAIL: a report for a day with no attendance must be rejected';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE 'Laporan harian hanya%' THEN
      RAISE EXCEPTION 'FAIL: rejected for the wrong reason: %', SQLERRM;
    END IF;
    RAISE NOTICE 'PASS: day without attendance rejected (%)', SQLERRM;
  END;

  -- The trigger, not just the RPCs: a direct write (teachers hold INSERT policies) is refused too.
  BEGIN
    INSERT INTO public.children_daily_reports (child_id, classroom_teacher_id, report_date)
    VALUES ('00000000-0000-4000-8000-000000000016', '00000000-0000-4000-8000-000000000019', '2026-08-04');
    RAISE EXCEPTION 'FAIL: a direct insert for an absent child must be rejected';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE 'Laporan harian hanya%' THEN
      RAISE EXCEPTION 'FAIL: rejected for the wrong reason: %', SQLERRM;
    END IF;
    RAISE NOTICE 'PASS: direct insert for absent child rejected (%)', SQLERRM;
  END;
END $$;

-- One report per class per day: Child One attended both programs on 2026-08-03, and each
-- teacher's report must stand on its own — the second save must neither take over nor clobber
-- the first.
DO $$
DECLARE
  v_first_id uuid;
  v_second_id uuid;
  v_reports int;
BEGIN
  SELECT id INTO v_first_id FROM public.children_daily_reports
    WHERE child_id = '00000000-0000-4000-8000-000000000016'
      AND classroom_teacher_id = '00000000-0000-4000-8000-000000000019'
      AND report_date = '2026-08-03';

  v_second_id := public.save_daily_report_mood(
    '00000000-0000-4000-8000-000000000016',
    '00000000-0000-4000-8000-000000000031',
    '2026-08-03',
    p_mood_arrival => 'sedih',
    p_teacher_note => 'Catatan kelas sore'
  );

  IF v_second_id = v_first_id THEN
    RAISE EXCEPTION 'FAIL: a second program on the same day must get its own report, not reuse %', v_first_id;
  END IF;

  SELECT count(*) INTO v_reports FROM public.children_daily_reports
    WHERE child_id = '00000000-0000-4000-8000-000000000016' AND report_date = '2026-08-03';
  IF v_reports <> 2 THEN
    RAISE EXCEPTION 'FAIL: expected 2 reports for two programs on one day, got %', v_reports;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.children_daily_reports
    WHERE id = v_first_id AND classroom_teacher_id = '00000000-0000-4000-8000-000000000019'
      AND mood_arrival IS NULL AND teacher_note IS NULL
  ) THEN
    RAISE EXCEPTION 'FAIL: saving the second program''s report changed the first one';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.children_daily_reports
    WHERE id = v_second_id AND mood_arrival = 'sedih' AND teacher_note = 'Catatan kelas sore'
  ) THEN
    RAISE EXCEPTION 'FAIL: save_daily_report_mood did not store mood_arrival / teacher_note';
  END IF;

  -- Each report matches exactly one attendance row.
  IF (
    SELECT count(*)
    FROM public.children_daily_reports r
    JOIN public.classroom_teachers ct ON ct.id = r.classroom_teacher_id
    JOIN public.child_attendances a ON a.child_id = r.child_id
                                   AND a.classroom_id = ct.classroom_id
                                   AND a.attendance_date = r.report_date
    WHERE r.id IN (v_first_id, v_second_id)
  ) <> 2 THEN
    RAISE EXCEPTION 'FAIL: each report should join to exactly one attendance row';
  END IF;
  RAISE NOTICE 'PASS: two programs on one day get two independent reports, each matching its attendance';
END $$;

-- A teacher must not be able to write into another teacher's group.
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"role":"teacher"}}';

DO $$
BEGIN
  BEGIN
    PERFORM public.save_daily_report_items(
      '00000000-0000-4000-8000-000000000016',
      '00000000-0000-4000-8000-000000000019',
      '2026-08-03',
      '[{"curriculum_item_id":"00000000-0000-4000-8000-000000000020","mastery_level":3}]'::jsonb
    );
    RAISE EXCEPTION 'FAIL: a teacher must not write reports for another teacher''s class';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: cross-teacher write rejected (%)', SQLERRM;
  END;

  IF EXISTS (SELECT 1 FROM public.children_daily_reports WHERE child_id = '00000000-0000-4000-8000-000000000016') THEN
    RAISE EXCEPTION 'FAIL: teacher B can read a report from teacher A''s class';
  END IF;
  RAISE NOTICE 'PASS: teacher B cannot read teacher A''s reports';
END $$;

-- ---------------------------------------------------------------------------
-- RLS — parent cannot read a draft
-- ---------------------------------------------------------------------------

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"role":"parent"}}';

DO $$
DECLARE
  v_reports int;
  v_items int;
BEGIN
  SELECT count(*) INTO v_reports FROM public.children_daily_reports
    WHERE child_id = '00000000-0000-4000-8000-000000000016';
  SELECT count(*) INTO v_items FROM public.daily_report_items;

  IF v_reports <> 0 THEN
    RAISE EXCEPTION 'FAIL: parent can read own child''s DRAFT report (% rows)', v_reports;
  END IF;
  IF v_items <> 0 THEN
    RAISE EXCEPTION 'FAIL: parent can read the entries of a DRAFT report (% rows)', v_items;
  END IF;
  RAISE NOTICE 'PASS: parent cannot read a draft report or its entries';
END $$;

-- ---------------------------------------------------------------------------
-- submit_daily_report — as Teacher A
-- ---------------------------------------------------------------------------

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"role":"teacher"}}';

DO $$
DECLARE
  v_report_id uuid;
  v_first timestamptz;
  v_second timestamptz;
BEGIN
  SELECT id INTO v_report_id FROM public.children_daily_reports
    WHERE child_id = '00000000-0000-4000-8000-000000000016'
      AND classroom_teacher_id = '00000000-0000-4000-8000-000000000019'
      AND report_date = '2026-08-03';

  v_first := public.submit_daily_report(v_report_id);
  IF v_first IS NULL THEN
    RAISE EXCEPTION 'FAIL: submit must stamp submitted_at';
  END IF;

  v_second := public.submit_daily_report(v_report_id);
  IF v_second <> v_first THEN
    RAISE EXCEPTION 'FAIL: re-submitting must keep the original timestamp (% vs %)', v_first, v_second;
  END IF;
  RAISE NOTICE 'PASS: submit stamps submitted_at and is idempotent';

  -- Once submitted, the parent has already seen it — the teacher can no longer rewrite it.
  BEGIN
    PERFORM public.save_daily_report_items(
      '00000000-0000-4000-8000-000000000016',
      '00000000-0000-4000-8000-000000000019',
      '2026-08-03',
      '[{"curriculum_item_id":"00000000-0000-4000-8000-000000000021","mastery_level":2}]'::jsonb
    );
    RAISE EXCEPTION 'FAIL: a submitted report must not be editable by the teacher';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: submitted report locked for the teacher (%)', SQLERRM;
  END;
END $$;

-- ---------------------------------------------------------------------------
-- RLS — parent reads own submitted report, but never another family's
-- ---------------------------------------------------------------------------

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"role":"parent"}}';

DO $$
DECLARE
  v_reports int;
  v_items int;
BEGIN
  SELECT count(*) INTO v_reports FROM public.children_daily_reports
    WHERE child_id = '00000000-0000-4000-8000-000000000016';
  SELECT count(*) INTO v_items FROM public.daily_report_items;

  IF v_reports <> 1 THEN
    RAISE EXCEPTION 'FAIL: parent should see own child''s submitted report, got % rows', v_reports;
  END IF;
  IF v_items <> 1 THEN
    RAISE EXCEPTION 'FAIL: parent should see the submitted report''s entries, got % rows', v_items;
  END IF;
  RAISE NOTICE 'PASS: parent reads own child''s submitted report and its entries';
END $$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated","app_metadata":{"role":"parent"}}';

DO $$
DECLARE
  v_reports int;
  v_items int;
BEGIN
  SELECT count(*) INTO v_reports FROM public.children_daily_reports
    WHERE child_id = '00000000-0000-4000-8000-000000000016';
  SELECT count(*) INTO v_items FROM public.daily_report_items;

  IF v_reports <> 0 THEN
    RAISE EXCEPTION 'FAIL: parent 2 can read family 1''s submitted report (% rows)', v_reports;
  END IF;
  IF v_items <> 0 THEN
    RAISE EXCEPTION 'FAIL: parent 2 can read family 1''s report entries (% rows)', v_items;
  END IF;
  RAISE NOTICE 'PASS: parent cannot read another family''s submitted report';
END $$;

-- ---------------------------------------------------------------------------
-- RLS — admin sees everything and can still correct a submitted report
-- ---------------------------------------------------------------------------

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"role":"admin"}}';

DO $$
DECLARE
  v_reports int;
BEGIN
  -- Both of Child One's reports: the submitted one and the second program's draft.
  SELECT count(*) INTO v_reports FROM public.children_daily_reports
    WHERE child_id = '00000000-0000-4000-8000-000000000016';
  IF v_reports <> 2 THEN
    RAISE EXCEPTION 'FAIL: admin should read both reports, got % rows', v_reports;
  END IF;

  PERFORM public.save_daily_report_items(
    '00000000-0000-4000-8000-000000000016',
    '00000000-0000-4000-8000-000000000019',
    '2026-08-03',
    '[{"curriculum_item_id":"00000000-0000-4000-8000-000000000021","mastery_level":2}]'::jsonb
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.daily_report_items dri
    JOIN public.children_daily_reports dr ON dr.id = dri.report_id
    WHERE dr.child_id = '00000000-0000-4000-8000-000000000016'
      AND dri.curriculum_item_id = '00000000-0000-4000-8000-000000000021'
  ) THEN
    RAISE EXCEPTION 'FAIL: admin should be able to correct a submitted report';
  END IF;
  RAISE NOTICE 'PASS: admin reads everything and can correct a submitted report';
END $$;

RESET ROLE;

DO $$ BEGIN RAISE NOTICE 'ALL DAILY REPORT TESTS PASSED'; END $$;

ROLLBACK;
