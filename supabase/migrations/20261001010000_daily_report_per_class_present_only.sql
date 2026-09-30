-- Makes a daily report line up one-to-one with the attendance row it reports on.
--
-- 1. One report per child PER CLASS per day, not per child per day.
--
--    child_attendances is keyed (child_id, classroom_id, attendance_date): since enrolment went
--    per program (20260921010000), a child can attend Bimba 08:00 and English 15:30 on the same
--    day and have two attendance rows. children_daily_reports was keyed (child_id, report_date),
--    so only one report could exist for that day. The second teacher to save either silently took
--    over the first teacher's draft — the upsert's ON CONFLICT rewrote classroom_teacher_id and
--    replaced the moods and teacher note — or, if the first was already sent, got "Report was
--    already submitted" and could not file one at all.
--
--    The new key is (child_id, classroom_teacher_id, report_date). A child is in exactly one
--    teaching group per program at a time (children_classrooms), so child + group + date always
--    means exactly one program, and each report now matches exactly one attendance row:
--
--      children_daily_reports r
--        JOIN classroom_teachers ct ON ct.id = r.classroom_teacher_id
--        JOIN child_attendances a   ON a.child_id = r.child_id
--                                  AND a.classroom_id = ct.classroom_id
--                                  AND a.attendance_date = r.report_date
--
--    The report keeps classroom_teacher_id rather than switching to classroom_id: the teacher
--    writes it and its RLS is teacher-scoped. Attendance keeps classroom_id because that is what
--    is billed (see the learning_periods.classroom_id comment in 20260803010000). Both are right
--    for what they record.
--
--    The table held 0 rows when this was written, so the key change moves no data.
--
-- 2. A report can only exist for a child recorded PRESENT in that class on that day.
--
--    Until now this was enforced only by the teacher UI (DailyReportStudentDialog locks the
--    report sections until a 'present' attendance is saved). The save RPCs checked enrolment but
--    not attendance, and teachers also hold direct INSERT/UPDATE policies on this table, so any
--    client could file a report for an absent child. It is now a BEFORE INSERT OR UPDATE trigger:
--    every write path — the two save RPCs, submit_daily_report's UPDATE, a direct write — goes
--    through it, including an admin's. A report for a child who wasn't there has nothing true to
--    say; a teacher who needs one should correct the attendance first.
--
--    Consequence worth knowing: if attendance is corrected from 'present' to 'absent' after a
--    report was saved, the existing row is left alone (nothing deletes it) but can no longer be
--    edited or submitted until attendance says present again.

-- ---------------------------------------------------------------------------
-- 1. The key.
-- ---------------------------------------------------------------------------

ALTER TABLE public.children_daily_reports DROP CONSTRAINT children_daily_reports_child_date_key;

ALTER TABLE public.children_daily_reports
  ADD CONSTRAINT children_daily_reports_child_class_date_key
  UNIQUE (child_id, classroom_teacher_id, report_date);

-- ---------------------------------------------------------------------------
-- 2. Present-only, as a trigger.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_daily_report_child_present()
RETURNS trigger
LANGUAGE plpgsql
-- SECURITY DEFINER so the attendance lookup works for every caller — a teacher's RLS on
-- child_attendances is scoped by classroom and would already allow this, but the check must not
-- depend on that staying true.
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.child_attendances ca
    JOIN public.classroom_teachers ct ON ct.classroom_id = ca.classroom_id
    WHERE ct.id = NEW.classroom_teacher_id
      AND ca.child_id = NEW.child_id
      AND ca.attendance_date = NEW.report_date
      AND ca.status = 'present'
  ) THEN
    RAISE EXCEPTION 'Laporan harian hanya bisa diisi untuk siswa yang tercatat hadir di kelas ini pada %', NEW.report_date;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_daily_report_child_present() IS
  'Refuses any insert or update of a children_daily_reports row unless the child has a ''present'' '
  'child_attendances row for the same program (via the report''s classroom_teacher_id) and date. '
  'The single enforcement point for "reports only for children who were there" — the teacher UI '
  'gates on the same rule, but this is what makes it true.';

DROP TRIGGER IF EXISTS enforce_child_present ON public.children_daily_reports;

CREATE TRIGGER enforce_child_present
  BEFORE INSERT OR UPDATE ON public.children_daily_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_daily_report_child_present();

-- ---------------------------------------------------------------------------
-- The two upsert RPCs: look the report up by (child, group, date) and conflict on the new key.
-- Everything else is copied unchanged from 20260930010000_children_daily_reports.sql.
--
-- The old ON CONFLICT set classroom_teacher_id = EXCLUDED.classroom_teacher_id — which is exactly
-- the takeover described in the header. With the group now part of the key, the conflicting row
-- already has this group, so there is nothing to move. save_daily_report_items still needs *a*
-- DO UPDATE (DO NOTHING would make RETURNING yield no row on conflict), so it re-sets the key
-- column to its own value.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.save_daily_report_items(
  p_child_id uuid,
  p_classroom_teacher_id uuid,
  p_report_date date,
  p_entries jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report_id uuid;
  v_submitted_at timestamptz;
  v_is_admin boolean := (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin';
BEGIN
  IF NOT public.can_write_daily_report(p_classroom_teacher_id) THEN
    RAISE EXCEPTION 'Not authorised to write reports for this class';
  END IF;

  IF jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION 'p_entries must be a JSON array';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.children_classrooms cc
    WHERE cc.child_id = p_child_id
      AND cc.classroom_teacher_id = p_classroom_teacher_id
      AND cc.started_at <= p_report_date
      AND (cc.ended_at IS NULL OR cc.ended_at >= p_report_date)
  ) THEN
    RAISE EXCEPTION 'Child was not enrolled in this class on %', p_report_date;
  END IF;

  -- ON CONFLICT below can only merge one row per (report_id, curriculum_item_id); a payload
  -- listing the same materi twice is a client bug, not something to silently pick a winner for.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_entries) e
    GROUP BY e ->> 'curriculum_item_id'
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'p_entries contains duplicate curriculum_item_id values';
  END IF;

  SELECT id, submitted_at INTO v_report_id, v_submitted_at
    FROM public.children_daily_reports
    WHERE child_id = p_child_id
      AND classroom_teacher_id = p_classroom_teacher_id
      AND report_date = p_report_date;

  IF v_report_id IS NOT NULL AND v_submitted_at IS NOT NULL AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Report was already submitted and can no longer be edited';
  END IF;

  INSERT INTO public.children_daily_reports (child_id, classroom_teacher_id, report_date, created_by)
  VALUES (p_child_id, p_classroom_teacher_id, p_report_date, auth.uid())
  ON CONFLICT ON CONSTRAINT children_daily_reports_child_class_date_key
  DO UPDATE SET report_date = EXCLUDED.report_date
  RETURNING id INTO v_report_id;

  WITH incoming AS (
    SELECT (e ->> 'curriculum_item_id')::uuid AS curriculum_item_id,
           (e ->> 'mastery_level')::smallint AS mastery_level
    FROM jsonb_array_elements(p_entries) e
  )
  DELETE FROM public.daily_report_items dri
  WHERE dri.report_id = v_report_id
    AND NOT EXISTS (
      SELECT 1 FROM incoming i WHERE i.curriculum_item_id = dri.curriculum_item_id
    );

  INSERT INTO public.daily_report_items (report_id, curriculum_item_id, mastery_level)
  SELECT v_report_id,
         (e ->> 'curriculum_item_id')::uuid,
         (e ->> 'mastery_level')::smallint
  FROM jsonb_array_elements(p_entries) e
  ON CONFLICT (report_id, curriculum_item_id)
  DO UPDATE SET mastery_level = EXCLUDED.mastery_level;

  RETURN v_report_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_daily_report_mood(
  p_child_id uuid,
  p_classroom_teacher_id uuid,
  p_report_date date,
  p_mood_arrival text DEFAULT NULL,
  p_mood_studying text DEFAULT NULL,
  p_mood_departure text DEFAULT NULL,
  p_mood_note text DEFAULT NULL,
  p_mood_note_parent text DEFAULT NULL,
  p_teacher_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report_id uuid;
  v_submitted_at timestamptz;
  v_is_admin boolean := (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin';
BEGIN
  IF NOT public.can_write_daily_report(p_classroom_teacher_id) THEN
    RAISE EXCEPTION 'Not authorised to write reports for this class';
  END IF;

  IF p_mood_arrival IS NOT NULL AND p_mood_arrival NOT IN ('senang', 'biasa', 'sedih') THEN
    RAISE EXCEPTION 'Unknown mood_arrival: %', p_mood_arrival;
  END IF;
  IF p_mood_studying IS NOT NULL AND p_mood_studying NOT IN ('senang', 'biasa', 'sedih') THEN
    RAISE EXCEPTION 'Unknown mood_studying: %', p_mood_studying;
  END IF;
  IF p_mood_departure IS NOT NULL AND p_mood_departure NOT IN ('senang', 'biasa', 'sedih') THEN
    RAISE EXCEPTION 'Unknown mood_departure: %', p_mood_departure;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.children_classrooms cc
    WHERE cc.child_id = p_child_id
      AND cc.classroom_teacher_id = p_classroom_teacher_id
      AND cc.started_at <= p_report_date
      AND (cc.ended_at IS NULL OR cc.ended_at >= p_report_date)
  ) THEN
    RAISE EXCEPTION 'Child was not enrolled in this class on %', p_report_date;
  END IF;

  SELECT id, submitted_at INTO v_report_id, v_submitted_at
    FROM public.children_daily_reports
    WHERE child_id = p_child_id
      AND classroom_teacher_id = p_classroom_teacher_id
      AND report_date = p_report_date;

  IF v_report_id IS NOT NULL AND v_submitted_at IS NOT NULL AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Report was already submitted and can no longer be edited';
  END IF;

  INSERT INTO public.children_daily_reports (
    child_id, classroom_teacher_id, report_date, created_by,
    mood_arrival, mood_studying, mood_departure, mood_note, mood_note_parent, teacher_note
  )
  VALUES (
    p_child_id, p_classroom_teacher_id, p_report_date, auth.uid(),
    p_mood_arrival, p_mood_studying, p_mood_departure, p_mood_note, p_mood_note_parent, p_teacher_note
  )
  ON CONFLICT ON CONSTRAINT children_daily_reports_child_class_date_key
  DO UPDATE SET
    mood_arrival = EXCLUDED.mood_arrival,
    mood_studying = EXCLUDED.mood_studying,
    mood_departure = EXCLUDED.mood_departure,
    mood_note = EXCLUDED.mood_note,
    mood_note_parent = EXCLUDED.mood_note_parent,
    teacher_note = EXCLUDED.teacher_note
  RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$$;
