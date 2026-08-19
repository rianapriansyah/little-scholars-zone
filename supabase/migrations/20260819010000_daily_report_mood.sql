-- Suasana Hati (mood) — third section of the paper form, per the plan noted in
-- 20260802010000_daily_reports_curriculum.sql: scalar columns on daily_reports, not a sibling
-- table, since a report has exactly one mood per moment per day (not a repeatable list like
-- daily_report_items).
--
-- Three moments — arrival, during class, departure — each a fixed 3-point scale (labels live
-- in src/lib/moods.ts, same convention as mastery_level in src/lib/masteryLevels.ts). One
-- shared note elaborates all three rather than a note per moment.

ALTER TABLE public.daily_reports
  ADD COLUMN mood_arrival text CHECK (mood_arrival IN ('senang', 'biasa', 'sedih')),
  ADD COLUMN mood_studying text CHECK (mood_studying IN ('senang', 'biasa', 'sedih')),
  ADD COLUMN mood_departure text CHECK (mood_departure IN ('senang', 'biasa', 'sedih')),
  ADD COLUMN mood_note text;

COMMENT ON COLUMN public.daily_reports.mood_arrival IS
  'Suasana hati ketika datang. NULL = not filled in yet (draft). Labels live in src/lib/moods.ts.';

COMMENT ON COLUMN public.daily_reports.mood_studying IS
  'Suasana hati ketika belajar. NULL = not filled in yet (draft).';

COMMENT ON COLUMN public.daily_reports.mood_departure IS
  'Suasana hati ketika pulang. NULL = not filled in yet (draft).';

COMMENT ON COLUMN public.daily_reports.mood_note IS
  'One shared elaboration covering all three moments, not per-moment. Optional, descriptive '
  'only — never affects mood_arrival/mood_studying/mood_departure.';

-- ---------------------------------------------------------------------------
-- Write path
-- ---------------------------------------------------------------------------

-- Upserts the report and sets its mood fields, mirroring save_daily_report_items(): same
-- enrolment check, same submitted-lock, same ON CONFLICT upsert of daily_reports. Kept as its
-- own RPC rather than folded into save_daily_report_items because Suasana Hati is its own
-- section of the dialog, saved independently of materi.
CREATE OR REPLACE FUNCTION public.save_daily_report_mood(
  p_child_id uuid,
  p_classroom_teacher_id uuid,
  p_report_date date,
  p_mood_arrival text DEFAULT NULL,
  p_mood_studying text DEFAULT NULL,
  p_mood_departure text DEFAULT NULL,
  p_mood_note text DEFAULT NULL
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
    FROM public.daily_reports
    WHERE child_id = p_child_id AND report_date = p_report_date;

  IF v_report_id IS NOT NULL AND v_submitted_at IS NOT NULL AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Report was already submitted and can no longer be edited';
  END IF;

  INSERT INTO public.daily_reports (
    child_id, classroom_teacher_id, report_date, created_by,
    mood_arrival, mood_studying, mood_departure, mood_note
  )
  VALUES (
    p_child_id, p_classroom_teacher_id, p_report_date, auth.uid(),
    p_mood_arrival, p_mood_studying, p_mood_departure, p_mood_note
  )
  ON CONFLICT ON CONSTRAINT daily_reports_child_date_key
  DO UPDATE SET
    classroom_teacher_id = EXCLUDED.classroom_teacher_id,
    mood_arrival = EXCLUDED.mood_arrival,
    mood_studying = EXCLUDED.mood_studying,
    mood_departure = EXCLUDED.mood_departure,
    mood_note = EXCLUDED.mood_note
  RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_daily_report_mood(uuid, uuid, date, text, text, text, text)
  TO authenticated, service_role;
