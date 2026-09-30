-- Suasana Hati and Catatan Guru each get their own save button in the teacher's report dialog,
-- the way Kehadiran already has (owner request). Saving one must never touch the other — not its
-- stored value, and not whatever the teacher has typed into it but not yet saved.
--
-- save_daily_report_mood (as of 20261001010000) was a whole-panel upsert: it wrote all three
-- moods, mood_note, mood_note_parent AND teacher_note from its arguments, NULL included. With
-- separate buttons, that shape forces the client to resend the other section's last-saved values
-- just so they aren't wiped, and gets it wrong the moment those values are stale. So it is split
-- into two narrow writers that each touch only their own columns:
--
--   save_daily_report_mood         → mood_arrival, mood_studying, mood_departure
--   save_daily_report_teacher_note → teacher_note
--
-- mood_note / mood_note_parent are no longer written by anything; existing values are left
-- exactly as they are.
--
-- Everything else — authorisation, mood validation, the enrolment check, the non-admin lock on a
-- submitted report — is copied from 20261001010000. The present-only rule is not repeated here:
-- the enforce_child_present trigger from that migration covers every write to the table.

DROP FUNCTION IF EXISTS public.save_daily_report_mood(uuid, uuid, date, text, text, text, text, text, text);

CREATE FUNCTION public.save_daily_report_mood(
  p_child_id uuid,
  p_classroom_teacher_id uuid,
  p_report_date date,
  p_mood_arrival text DEFAULT NULL,
  p_mood_studying text DEFAULT NULL,
  p_mood_departure text DEFAULT NULL
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

  -- The three moods are one unit (one Simpan button saves all three), so NULL here does mean
  -- "cleared" — but only for the moods. teacher_note is not in this statement at all.
  INSERT INTO public.children_daily_reports (
    child_id, classroom_teacher_id, report_date, created_by,
    mood_arrival, mood_studying, mood_departure
  )
  VALUES (
    p_child_id, p_classroom_teacher_id, p_report_date, auth.uid(),
    p_mood_arrival, p_mood_studying, p_mood_departure
  )
  ON CONFLICT ON CONSTRAINT children_daily_reports_child_class_date_key
  DO UPDATE SET
    mood_arrival = EXCLUDED.mood_arrival,
    mood_studying = EXCLUDED.mood_studying,
    mood_departure = EXCLUDED.mood_departure
  RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$$;

CREATE FUNCTION public.save_daily_report_teacher_note(
  p_child_id uuid,
  p_classroom_teacher_id uuid,
  p_report_date date,
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

  -- A blank note is stored as NULL rather than '', so "has a note" is a plain IS NOT NULL.
  INSERT INTO public.children_daily_reports (
    child_id, classroom_teacher_id, report_date, created_by, teacher_note
  )
  VALUES (
    p_child_id, p_classroom_teacher_id, p_report_date, auth.uid(), NULLIF(btrim(p_teacher_note), '')
  )
  ON CONFLICT ON CONSTRAINT children_daily_reports_child_class_date_key
  DO UPDATE SET teacher_note = EXCLUDED.teacher_note
  RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_daily_report_mood(uuid, uuid, date, text, text, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_daily_report_teacher_note(uuid, uuid, date, text)
  TO authenticated, service_role;
