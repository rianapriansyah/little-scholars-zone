-- Adds a 5-minute grace period on the late side of Selesaikan Kelas, matching Masuk Kelas's
-- existing symmetric window.
--
-- 20260810050000 gave clock-out grace only on the early side (5 minutes before the scheduled
-- end through the end itself) and none at all after it — any tap even a second past the exact
-- scheduled end kept the real time and read as 'overtime'. In practice that flagged nearly
-- every real tap: human reaction time and network latency alone are enough to land a few
-- seconds late, and witaWallClockTime only displays HH:mm, so the admin sees "10:00 AM" next to
-- an "Over Time" chip with no visible reason why (confirmed against a real row: clocked out at
-- 10:00:10.868 against a 10:00:00 end — 11 seconds late, displayed identically to on time).
--
-- Now: on time runs from 5 minutes before the scheduled end through 5 minutes after it. Only a
-- tap genuinely later than that keeps the real time and reads as 'overtime'.

CREATE OR REPLACE FUNCTION public.clock_out_classroom_teacher(p_classroom_teacher_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_teacher_id uuid;
  v_time_end time;
  v_session_date date;
  v_scheduled_end timestamptz;
  v_recorded_at timestamptz;
  v_id uuid;
  v_clocked_in_at timestamptz;
BEGIN
  SELECT t.id, c.time_end
    INTO v_teacher_id, v_time_end
    FROM public.classroom_teachers ct
    JOIN public.teachers t ON t.id = ct.teacher_id
    JOIN public.classrooms c ON c.id = ct.classroom_id
    WHERE ct.id = p_classroom_teacher_id
      AND t.auth_user_id = auth.uid();

  IF v_teacher_id IS NULL THEN
    RAISE EXCEPTION 'Not authorised to clock out for this class';
  END IF;

  v_session_date := (now() AT TIME ZONE 'Asia/Makassar')::date;
  v_scheduled_end := (v_session_date::text || ' ' || v_time_end::text)::timestamp
    AT TIME ZONE 'Asia/Makassar';

  IF now() < v_scheduled_end - interval '5 minutes' THEN
    RAISE EXCEPTION 'Belum waktunya absen selesai (mulai 5 menit sebelum jadwal kelas berakhir)';
  END IF;

  SELECT id, clocked_in_at INTO v_id, v_clocked_in_at
    FROM public.classroom_teachers_attendances
    WHERE classroom_teacher_id = p_classroom_teacher_id AND session_date = v_session_date;

  IF v_id IS NULL OR v_clocked_in_at IS NULL THEN
    RAISE EXCEPTION 'Belum absen masuk untuk kelas ini hari ini';
  END IF;

  -- Grace now runs 5 minutes either side of the scheduled end, not just up to it — see the file
  -- header for why a zero-tolerance late side was the wrong call in practice.
  v_recorded_at := CASE
    WHEN now() <= v_scheduled_end + interval '5 minutes' THEN v_scheduled_end
    ELSE now()
  END;

  -- Idempotent, same reasoning as clock-in: COALESCE leaves an existing clock-out untouched.
  UPDATE public.classroom_teachers_attendances
    SET clocked_out_at = COALESCE(clocked_out_at, v_recorded_at),
        clocked_out_source = COALESCE(clocked_out_source, 'teacher')
    WHERE id = v_id;

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- classroom_teachers_attendance_status: move the 'overtime' threshold out to end + 5 minutes,
-- matching the RPC above exactly — same reasoning as arrival_status's own +5 minute threshold.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.classroom_teachers_attendance_status
WITH (security_invoker = true) AS
SELECT
  ta.*,
  (ta.session_date::text || ' ' || c.time_start::text)::timestamp
    AT TIME ZONE 'Asia/Makassar' AS scheduled_start,
  (ta.session_date::text || ' ' || c.time_end::text)::timestamp
    AT TIME ZONE 'Asia/Makassar' AS scheduled_end,
  CASE
    WHEN ta.clocked_in_at IS NULL OR ta.clocked_out_at IS NULL THEN NULL
    ELSE round(extract(epoch FROM (ta.clocked_out_at - ta.clocked_in_at)) / 60)::int
  END AS minutes_taught,
  CASE
    WHEN ta.clocked_in_at IS NULL THEN 'missing'
    WHEN ta.clocked_in_at > (ta.session_date::text || ' ' || c.time_start::text)::timestamp
      AT TIME ZONE 'Asia/Makassar' + interval '5 minutes' THEN 'late'
    ELSE 'on_time'
  END AS arrival_status,
  CASE
    WHEN ta.clocked_out_at IS NULL THEN 'missing'
    WHEN ta.clocked_out_at < (ta.session_date::text || ' ' || c.time_end::text)::timestamp
      AT TIME ZONE 'Asia/Makassar' - interval '5 minutes' THEN 'early'
    WHEN ta.clocked_out_at > (ta.session_date::text || ' ' || c.time_end::text)::timestamp
      AT TIME ZONE 'Asia/Makassar' + interval '5 minutes' THEN 'overtime'
    ELSE 'on_time'
  END AS departure_status
FROM public.classroom_teachers_attendances ta
JOIN public.classroom_teachers ct ON ct.id = ta.classroom_teacher_id
JOIN public.classrooms c ON c.id = ct.classroom_id;

COMMENT ON VIEW public.classroom_teachers_attendance_status IS
  'classroom_teachers_attendances plus the scheduled instants and flags derived from them. '
  'arrival_status/departure_status are flags only, never used to dock pay — payroll stays a '
  'manual process an admin runs off this data. security_invoker so the base table''s and '
  'classrooms''/classroom_teachers'' RLS policies apply to readers of the view. departure_status: '
  '''overtime'' means the real clock-out landed more than 5 minutes past the scheduled end — a '
  'normalised on-time punch is always exactly scheduled_end, so anything strictly later than '
  'end + 5 minutes can only be a kept-real, genuinely late value.';
