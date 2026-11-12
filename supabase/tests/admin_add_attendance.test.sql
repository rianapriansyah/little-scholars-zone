-- Tests for Tambah Absen from a learning period (20261113010000_admin_add_attendance_by_learning_period.sql):
-- record_attendance with an admin-named period, and save_daily_report_*_for_period.
--
-- The case it exists for: a closed period, and a date that no children_classrooms placement covers
-- (a gap between two placements in the same group). The admin flow must not need a teaching group.
--
-- One transaction ending in ROLLBACK, so it is safe to run against the live project:
--   npx supabase db query --linked -f supabase/tests/admin_add_attendance.test.sql
-- Any 'FAIL' or an aborted run is a broken test. A clean run ends with
-- 'ALL ADMIN ADD ATTENDANCE TESTS PASSED'.

BEGIN;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_app_meta_data, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-9000-000000000001', 'authenticated', 'authenticated', 'test-aaa-admin@example.test',   '{"role":"admin"}',   now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-9000-000000000002', 'authenticated', 'authenticated', 'test-aaa-teacher@example.test', '{"role":"teacher"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-9000-000000000003', 'authenticated', 'authenticated', 'test-aaa-parent@example.test',  '{"role":"parent"}',  now(), now());

INSERT INTO public.employees (id, full_name, email, auth_user_id) VALUES
  ('00000000-0000-4000-9000-000000000012', 'Test AAA Teacher', 'test-aaa-teacher@example.test', '00000000-0000-4000-9000-000000000002');

INSERT INTO public.families (id, login_email, auth_user_id) VALUES
  ('00000000-0000-4000-9000-000000000014', 'test-aaa-parent@example.test', '00000000-0000-4000-9000-000000000003');

-- Gap Child: placed 1–10 Jan, then again from 20 Jan, same group — 11–19 Jan uncovered.
-- Gone Child: placed 1–10 Jan only, no active placement today.
INSERT INTO public.children (id, family_id, full_name) VALUES
  ('00000000-0000-4000-9000-000000000016', '00000000-0000-4000-9000-000000000014', 'Test AAA Gap Child'),
  ('00000000-0000-4000-9000-000000000017', '00000000-0000-4000-9000-000000000014', 'Test AAA Gone Child');

INSERT INTO public.classrooms (id, label, time_start, time_end, price) VALUES
  ('00000000-0000-4000-9000-000000000018', 'Test AAA Classroom', '08:00', '10:00', 0);

INSERT INTO public.classroom_teachers (id, classroom_id, teacher_id) VALUES
  ('00000000-0000-4000-9000-000000000019', '00000000-0000-4000-9000-000000000018', '00000000-0000-4000-9000-000000000012');

INSERT INTO public.children_classrooms (child_id, classroom_teacher_id, started_at, ended_at) VALUES
  ('00000000-0000-4000-9000-000000000016', '00000000-0000-4000-9000-000000000019', '2026-01-01', '2026-01-10'),
  ('00000000-0000-4000-9000-000000000016', '00000000-0000-4000-9000-000000000019', '2026-01-20', NULL),
  ('00000000-0000-4000-9000-000000000017', '00000000-0000-4000-9000-000000000019', '2026-01-01', '2026-01-10');

-- Gap Child's Periode 1: 3 guaranteed days, 2 used, closed by hand (Selesai). Periode 2 is open.
INSERT INTO public.children_learning_periods (id, child_id, classroom_id, period_no, start_date, guaranteed_days, closed_at) VALUES
  ('00000000-0000-4000-9000-000000000040', '00000000-0000-4000-9000-000000000016', '00000000-0000-4000-9000-000000000018', 1, '2026-01-01', 3, now()),
  ('00000000-0000-4000-9000-000000000041', '00000000-0000-4000-9000-000000000016', '00000000-0000-4000-9000-000000000018', 2, '2026-01-20', 3, NULL),
  ('00000000-0000-4000-9000-000000000042', '00000000-0000-4000-9000-000000000017', '00000000-0000-4000-9000-000000000018', 1, '2026-01-01', 3, NULL);
-- An insert trigger fills guaranteed_days from the classroom's default; set the small quota after.
UPDATE public.children_learning_periods SET guaranteed_days = 3
 WHERE id IN ('00000000-0000-4000-9000-000000000040', '00000000-0000-4000-9000-000000000041', '00000000-0000-4000-9000-000000000042');

INSERT INTO public.children_attendances (learning_period_id, child_id, classroom_id, attendance_date, status) VALUES
  ('00000000-0000-4000-9000-000000000040', '00000000-0000-4000-9000-000000000016', '00000000-0000-4000-9000-000000000018', '2026-01-05', 'present'),
  ('00000000-0000-4000-9000-000000000040', '00000000-0000-4000-9000-000000000016', '00000000-0000-4000-9000-000000000018', '2026-01-06', 'present');

INSERT INTO public.curriculum_items (id, subject, label, sort_order) VALUES
  ('00000000-0000-4000-9000-000000000020', 'literasi', 'TEST AAA Materi 1', 1);

-- ---------------------------------------------------------------------------
-- As admin: the whole Tambah Absen flow on a closed period, on an uncovered date.
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-9000-000000000001","role":"authenticated","app_metadata":{"role":"admin"}}';

DO $$
DECLARE
  v_child uuid := '00000000-0000-4000-9000-000000000016';
  v_room uuid := '00000000-0000-4000-9000-000000000018';
  v_p1 uuid := '00000000-0000-4000-9000-000000000040';
  v_att uuid;
  v_report uuid;
  v_again uuid;
  v_row record;
BEGIN
  -- Kehadiran: 15 Jan sits in the placement gap, on the closed Periode 1.
  v_att := public.record_attendance(v_child, v_room, '2026-01-15', 'present', NULL, v_p1);
  IF NOT EXISTS (
    SELECT 1 FROM public.children_attendances
     WHERE id = v_att AND learning_period_id = v_p1 AND status = 'present'
  ) THEN
    RAISE EXCEPTION 'FAIL: the day should be filed on the chosen (closed) period';
  END IF;
  RAISE NOTICE 'PASS: admin records a day on a closed period with no placement on that date';

  -- Suasana Hati / Catatan Guru / Materi all land on one report, linked to that absensi row.
  v_report := public.save_daily_report_mood_for_period(v_p1, '2026-01-15', 'senang', 'biasa', 'senang');
  SELECT * INTO v_row FROM public.children_daily_reports WHERE id = v_report;
  IF v_row.child_attendance_id <> v_att OR v_row.mood_studying <> 'biasa' OR v_row.child_id <> v_child THEN
    RAISE EXCEPTION 'FAIL: mood save should create the report on the absensi row';
  END IF;

  v_again := public.save_daily_report_teacher_note_for_period(v_p1, '2026-01-15', '  Hari yang baik  ');
  IF v_again <> v_report THEN
    RAISE EXCEPTION 'FAIL: note save should reuse the report (% vs %)', v_again, v_report;
  END IF;
  IF (SELECT teacher_note FROM public.children_daily_reports WHERE id = v_report) <> 'Hari yang baik' THEN
    RAISE EXCEPTION 'FAIL: note should be trimmed and stored';
  END IF;
  -- The note save leaves the moods alone.
  IF (SELECT mood_arrival FROM public.children_daily_reports WHERE id = v_report) <> 'senang' THEN
    RAISE EXCEPTION 'FAIL: note save must not touch the moods';
  END IF;

  v_again := public.save_daily_report_items_for_period(
    v_p1, '2026-01-15', '[{"curriculum_item_id":"00000000-0000-4000-9000-000000000020","mastery_level":4}]'::jsonb
  );
  IF v_again <> v_report
     OR (SELECT count(*) FROM public.daily_report_items WHERE report_id = v_report) <> 1 THEN
    RAISE EXCEPTION 'FAIL: items save should write one entry on the same report';
  END IF;
  RAISE NOTICE 'PASS: mood, note and materi save by (period, date) onto one report';

  -- Kirim works without a group.
  PERFORM public.submit_daily_report(v_report);
  IF (SELECT submitted_at FROM public.children_daily_reports WHERE id = v_report) IS NULL THEN
    RAISE EXCEPTION 'FAIL: admin should be able to submit the report';
  END IF;

  -- Read back through the existing reader; no placement → no group → attributed to Admin.
  SELECT * INTO v_row FROM public.daily_report_for_attendance(v_child, v_room, '2026-01-15');
  IF v_row.id IS DISTINCT FROM v_report OR NOT v_row.author_is_admin THEN
    RAISE EXCEPTION 'FAIL: daily_report_for_attendance should return the admin-authored report';
  END IF;
  IF public.daily_report_group_id(v_att) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: an uncovered date should have no derived group';
  END IF;
  RAISE NOTICE 'PASS: submit and read back without a teaching group';

  -- A day that is not 'present' has no report to write.
  PERFORM public.record_attendance(v_child, v_room, '2026-01-16', 'absent', NULL, '00000000-0000-4000-9000-000000000041');
  BEGIN
    PERFORM public.save_daily_report_mood_for_period('00000000-0000-4000-9000-000000000041', '2026-01-16', 'senang', 'senang', 'senang');
    RAISE EXCEPTION 'FAIL: a report must be refused on an absent day';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: report refused on a non-present day (%)', SQLERRM;
  END;

  -- Periode 1 is now 3/3: one more day on it is refused.
  BEGIN
    PERFORM public.record_attendance(v_child, v_room, '2026-01-17', 'present', NULL, v_p1);
    RAISE EXCEPTION 'FAIL: a full period must refuse another day';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: full period still refuses (%)', SQLERRM;
  END;

  -- A child with no active placement at all can still be back-filled on their own period.
  PERFORM public.record_attendance(
    '00000000-0000-4000-9000-000000000017', v_room, '2026-01-08', 'present', NULL, '00000000-0000-4000-9000-000000000042'
  );
  RAISE NOTICE 'PASS: admin-named period does not require a current placement';

  -- The period must still belong to the child and class.
  BEGIN
    PERFORM public.record_attendance(
      '00000000-0000-4000-9000-000000000017', v_room, '2026-01-09', 'present', NULL, v_p1
    );
    RAISE EXCEPTION 'FAIL: another child''s period must be refused';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: another child''s period is refused (%)', SQLERRM;
  END;
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- As teacher: the _for_period writers are admin only; the old enrolment check still applies.
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-9000-000000000002","role":"authenticated","app_metadata":{"role":"teacher"}}';

DO $$
BEGIN
  BEGIN
    PERFORM public.save_daily_report_teacher_note_for_period('00000000-0000-4000-9000-000000000040', '2026-01-15', 'x');
    RAISE EXCEPTION 'FAIL: a teacher must not use the period writers';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: period writers refuse a teacher (%)', SQLERRM;
  END;

  BEGIN
    PERFORM public.record_attendance(
      '00000000-0000-4000-9000-000000000017', '00000000-0000-4000-9000-000000000018', '2026-01-09', 'present'
    );
    RAISE EXCEPTION 'FAIL: a teacher must not record a child with no active placement';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: teacher path keeps the enrolment check (%)', SQLERRM;
  END;
END $$;

RESET ROLE;

DO $$ BEGIN RAISE NOTICE 'ALL ADMIN ADD ATTENDANCE TESTS PASSED'; END $$;

ROLLBACK;
