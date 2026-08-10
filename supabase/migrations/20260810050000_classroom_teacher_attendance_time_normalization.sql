-- Changes what the teacher-facing clock-in/out RPCs actually record, and removes the "missed"
-- rejection on clock-in.
--
-- Masuk Kelas previously refused the tap outright once more than 5 minutes had passed since
-- the scheduled start ("Di luar jendela absen masuk"), forcing a genuinely late teacher to have
-- an admin backfill the punch. That rejection is gone: the button now stays pressable
-- indefinitely once its 5-minutes-before floor has passed (see the client-side
-- getClockInWindowStatus, which drops its 'missed' branch to match). Lateness is recorded
-- instead of blocked.
--
-- What gets WRITTEN as clocked_in_at/clocked_out_at also changes, in both RPCs:
--   * Within the grace window, the recorded instant is normalised to the classroom's own
--     scheduled instant, not the literal tap time — a teacher who taps a little early or a
--     little late within grace is simply "on time", with an exact, consistent timestamp.
--   * Outside grace, the real tap time is kept, which is what makes it read as late/overtime.
--
-- Clock-in grace is symmetric (start ± 5 minutes), since arriving a touch early or a touch late
-- are both still "on time" in the ordinary sense. Clock-out grace is one-sided (end − 5 minutes
-- through end): the button only ever opens 5 minutes before the scheduled end, so "on time" runs
-- from the moment it opens through to the scheduled end itself; anything tapped after the
-- scheduled end is the class genuinely running long.

CREATE OR REPLACE FUNCTION public.clock_in_classroom_teacher(p_classroom_teacher_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_teacher_id uuid;
  v_time_start time;
  v_session_date date;
  v_scheduled_start timestamptz;
  v_recorded_at timestamptz;
  v_id uuid;
BEGIN
  SELECT t.id, c.time_start
    INTO v_teacher_id, v_time_start
    FROM public.classroom_teachers ct
    JOIN public.teachers t ON t.id = ct.teacher_id
    JOIN public.classrooms c ON c.id = ct.classroom_id
    WHERE ct.id = p_classroom_teacher_id
      AND t.auth_user_id = auth.uid();

  IF v_teacher_id IS NULL THEN
    RAISE EXCEPTION 'Not authorised to clock in for this class';
  END IF;

  v_session_date := (now() AT TIME ZONE 'Asia/Makassar')::date;
  v_scheduled_start := (v_session_date::text || ' ' || v_time_start::text)::timestamp
    AT TIME ZONE 'Asia/Makassar';

  -- Only a floor now — see the file header for why the old upper-bound rejection is gone.
  IF now() < v_scheduled_start - interval '5 minutes' THEN
    RAISE EXCEPTION 'Belum waktunya absen masuk (mulai 5 menit sebelum jadwal kelas dimulai)';
  END IF;

  v_recorded_at := CASE
    WHEN now() <= v_scheduled_start + interval '5 minutes' THEN v_scheduled_start
    ELSE now()
  END;

  -- Idempotent: a second tap must not shift an already-recorded time.
  INSERT INTO public.classroom_teachers_attendances (classroom_teacher_id, session_date, clocked_in_at, clocked_in_source)
  VALUES (p_classroom_teacher_id, v_session_date, v_recorded_at, 'teacher')
  ON CONFLICT ON CONSTRAINT classroom_teachers_attendances_key DO NOTHING;

  SELECT id INTO v_id
    FROM public.classroom_teachers_attendances
    WHERE classroom_teacher_id = p_classroom_teacher_id AND session_date = v_session_date;

  RETURN v_id;
END;
$$;

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

  v_recorded_at := CASE
    WHEN now() <= v_scheduled_end THEN v_scheduled_end
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
-- classroom_teachers_attendance_status: add an 'overtime' departure_status.
--
-- arrival_status's threshold (clocked_in_at > scheduled_start + 5 minutes) is untouched — it
-- already matches the new RPC exactly: a normalised on-time punch always equals scheduled_start
-- (well inside the threshold), and a kept-real late punch is by construction always past it.
-- 'early' also stays, for a genuinely early admin-entered correction — the teacher RPC itself
-- can never produce clocked_out_at before scheduled_end anymore, so 'early' now only appears on
-- admin-entered rows, same as 'late' on arrival.
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
      AT TIME ZONE 'Asia/Makassar' THEN 'overtime'
    ELSE 'on_time'
  END AS departure_status
FROM public.classroom_teachers_attendances ta
JOIN public.classroom_teachers ct ON ct.id = ta.classroom_teacher_id
JOIN public.classrooms c ON c.id = ct.classroom_id;

COMMENT ON VIEW public.classroom_teachers_attendance_status IS
  'classroom_teachers_attendances plus the scheduled instants and flags derived from them. '
  'arrival_status/departure_status are flags only, never used to dock pay — payroll stays a '
  'manual process an admin runs off this data. security_invoker so the base table''s and '
  'classrooms''/classroom_teachers'' RLS policies apply to readers of the view. departure_status '
  'gained ''overtime'' alongside the existing ''early'' — the teacher RPC now normalises an '
  'on-time clock-out to exactly scheduled_end, so a value past it means the class ran long.';
