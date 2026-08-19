-- The parent-facing rewrite of Suasana Hati's mood_note. mood_note stays the teacher's raw
-- original and is never exposed to a parent; mood_note_parent is the (optionally teacher-
-- edited) rewrite produced by the translate-mood-note edge function. NULL until generated —
-- the dialog falls back to showing nothing rather than the raw note.

ALTER TABLE public.daily_reports
  ADD COLUMN mood_note_parent text;

COMMENT ON COLUMN public.daily_reports.mood_note_parent IS
  'Parent-facing rewrite of mood_note, produced by the translate-mood-note edge function and '
  'reviewable/editable by the teacher before saving. NULL until generated. Never derive this '
  'from mood_note automatically on read — it is only ever set explicitly via '
  'save_daily_report_mood().';

-- CREATE OR REPLACE cannot change a function's parameter list — it would create a second,
-- overloaded 8-arg version instead of replacing the 7-arg one, and PostgREST RPC calls would
-- then fail to resolve which overload to use. Drop the old signature explicitly first.
DROP FUNCTION IF EXISTS public.save_daily_report_mood(uuid, uuid, date, text, text, text, text);

CREATE OR REPLACE FUNCTION public.save_daily_report_mood(
  p_child_id uuid,
  p_classroom_teacher_id uuid,
  p_report_date date,
  p_mood_arrival text DEFAULT NULL,
  p_mood_studying text DEFAULT NULL,
  p_mood_departure text DEFAULT NULL,
  p_mood_note text DEFAULT NULL,
  p_mood_note_parent text DEFAULT NULL
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
    mood_arrival, mood_studying, mood_departure, mood_note, mood_note_parent
  )
  VALUES (
    p_child_id, p_classroom_teacher_id, p_report_date, auth.uid(),
    p_mood_arrival, p_mood_studying, p_mood_departure, p_mood_note, p_mood_note_parent
  )
  ON CONFLICT ON CONSTRAINT daily_reports_child_date_key
  DO UPDATE SET
    classroom_teacher_id = EXCLUDED.classroom_teacher_id,
    mood_arrival = EXCLUDED.mood_arrival,
    mood_studying = EXCLUDED.mood_studying,
    mood_departure = EXCLUDED.mood_departure,
    mood_note = EXCLUDED.mood_note,
    mood_note_parent = EXCLUDED.mood_note_parent
  RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_daily_report_mood(uuid, uuid, date, text, text, text, text, text)
  TO authenticated, service_role;
