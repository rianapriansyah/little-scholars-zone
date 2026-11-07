-- Flexi-hours (is_flexi_hours) work: the teacher picks the time instead of the tap being the time.
--
-- Mulai / Lanjutkan / Selesai on a flexi work item (Pembuatan Konten) now open a dialog where the
-- teacher chooses the time, defaulting to now. Both RPCs gain an optional p_at; NULL keeps the old
-- behaviour (stamp now()), so a client that does not send it still works.
--
-- p_at is only accepted on a flexi item. A scheduled class keeps its window checks and its
-- normalise-to-schedule rule, and an explicit time there would sidestep both — so it is refused
-- rather than silently ignored.
--
-- Rules for a chosen time, all re-checked here because the client cannot be trusted with them:
--   * it is today, in WITA (the row is keyed on today's session_date);
--   * it is not in the future (one minute of slack for a phone clock running slightly ahead);
--   * a new session does not start before the previous one finished (sessions never overlap);
--   * a session does not finish before it started.
--
-- Adding a parameter changes the signature, so the old one-argument functions are dropped first;
-- otherwise a one-argument call would be ambiguous between the two overloads.

DROP FUNCTION IF EXISTS public.clock_in_classroom_teacher(uuid);
DROP FUNCTION IF EXISTS public.clock_out_classroom_teacher(uuid);

CREATE FUNCTION public.clock_in_classroom_teacher(
  p_classroom_teacher_id uuid,
  p_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_teacher_id uuid;
  v_time_start time;
  v_is_flexi_hours boolean;
  v_session_date date;
  v_scheduled_start timestamptz;
  v_recorded_at timestamptz;
  v_id uuid;
  v_has_open_session boolean;
  v_previous_end timestamptz;
BEGIN
  SELECT t.id, c.time_start, c.is_flexi_hours
    INTO v_teacher_id, v_time_start, v_is_flexi_hours
    FROM public.classroom_teachers ct
    JOIN public.employees t ON t.id = ct.teacher_id
    JOIN public.classrooms c ON c.id = ct.classroom_id
    WHERE ct.id = p_classroom_teacher_id
      AND t.auth_user_id = auth.uid();

  IF v_teacher_id IS NULL THEN
    RAISE EXCEPTION 'Not authorised to clock in for this class';
  END IF;

  v_session_date := (now() AT TIME ZONE 'Asia/Makassar')::date;

  IF v_is_flexi_hours THEN
    -- No schedule to validate or normalise against — any time, any day. The time is the one the
    -- teacher picked, or the tap itself when she did not send one.
    v_recorded_at := COALESCE(p_at, now());

    IF v_recorded_at > now() + interval '1 minute' THEN
      RAISE EXCEPTION 'Waktu mulai tidak boleh melebihi waktu sekarang';
    END IF;
    IF (v_recorded_at AT TIME ZONE 'Asia/Makassar')::date <> v_session_date THEN
      RAISE EXCEPTION 'Waktu mulai harus hari ini';
    END IF;
  ELSE
    IF p_at IS NOT NULL THEN
      RAISE EXCEPTION 'Waktu hanya bisa dipilih untuk jadwal fleksibel';
    END IF;

    v_scheduled_start := (v_session_date::text || ' ' || v_time_start::text)::timestamp
      AT TIME ZONE 'Asia/Makassar';

    IF now() < v_scheduled_start - interval '60 minutes' THEN
      RAISE EXCEPTION 'Belum waktunya absen masuk (mulai 1 jam sebelum jadwal kelas dimulai)';
    END IF;

    v_recorded_at := CASE
      WHEN now() <= v_scheduled_start + interval '5 minutes' THEN v_scheduled_start
      ELSE now()
    END;
  END IF;

  PERFORM set_config('app.work_sessions_managed', 'on', true);

  -- Idempotent for a scheduled class: a second tap must not shift an already-recorded time.
  INSERT INTO public.classroom_teachers_attendances (classroom_teacher_id, session_date, clocked_in_at, clocked_in_source)
  VALUES (p_classroom_teacher_id, v_session_date, v_recorded_at, 'teacher')
  ON CONFLICT ON CONSTRAINT classroom_teachers_attendances_key DO NOTHING;

  SELECT id INTO v_id
    FROM public.classroom_teachers_attendances
    WHERE classroom_teacher_id = p_classroom_teacher_id AND session_date = v_session_date;

  IF v_is_flexi_hours THEN
    PERFORM public.materialize_flexi_work_session(v_id);

    SELECT EXISTS (
      SELECT 1 FROM public.classroom_teacher_work_sessions
      WHERE attendance_id = v_id AND ended_at IS NULL
    ) INTO v_has_open_session;

    -- Already running: a double-tap, nothing to do. The one-open-session unique index would refuse
    -- the insert below anyway; checking here turns that into a quiet no-op rather than an error.
    IF NOT v_has_open_session THEN
      -- Lanjutkan: the new session may not start inside the one before it.
      SELECT max(ended_at) INTO v_previous_end
        FROM public.classroom_teacher_work_sessions
        WHERE attendance_id = v_id;

      IF v_previous_end IS NOT NULL AND v_recorded_at < v_previous_end THEN
        RAISE EXCEPTION 'Waktu mulai tidak boleh sebelum sesi sebelumnya selesai (%)',
          to_char(v_previous_end AT TIME ZONE 'Asia/Makassar', 'HH24:MI');
      END IF;

      INSERT INTO public.classroom_teacher_work_sessions (attendance_id, started_at)
      VALUES (v_id, v_recorded_at);

      -- The day is running again, so it has no finish time until she presses Selesai.
      -- clocked_in_at keeps pointing at the FIRST session's start — it is the day's "jam masuk" on
      -- every screen and in the monthly PDF, and the paid total comes from the sessions, not from
      -- this pair.
      UPDATE public.classroom_teachers_attendances
        SET clocked_out_at = NULL,
            clocked_out_source = NULL
        WHERE id = v_id AND clocked_out_at IS NOT NULL;
    END IF;
  END IF;

  -- Lowered again on the way out, not left raised for whatever else shares this transaction.
  PERFORM set_config('app.work_sessions_managed', '', true);

  RETURN v_id;
END;
$function$;

COMMENT ON FUNCTION public.clock_in_classroom_teacher(uuid, timestamptz) IS
  'Masuk Kelas / Mulai / Lanjutkan. p_at (flexi-hours only) is the time the teacher picked; NULL = now().';

GRANT EXECUTE ON FUNCTION public.clock_in_classroom_teacher(uuid, timestamptz) TO authenticated, service_role;

CREATE FUNCTION public.clock_out_classroom_teacher(
  p_classroom_teacher_id uuid,
  p_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_teacher_id uuid;
  v_time_end time;
  v_is_flexi_hours boolean;
  v_session_date date;
  v_scheduled_end timestamptz;
  v_recorded_at timestamptz;
  v_id uuid;
  v_clocked_in_at timestamptz;
  v_open_session_id uuid;
  v_open_session_start timestamptz;
BEGIN
  SELECT t.id, c.time_end, c.is_flexi_hours
    INTO v_teacher_id, v_time_end, v_is_flexi_hours
    FROM public.classroom_teachers ct
    JOIN public.employees t ON t.id = ct.teacher_id
    JOIN public.classrooms c ON c.id = ct.classroom_id
    WHERE ct.id = p_classroom_teacher_id
      AND t.auth_user_id = auth.uid();

  IF v_teacher_id IS NULL THEN
    RAISE EXCEPTION 'Not authorised to clock out for this class';
  END IF;

  v_session_date := (now() AT TIME ZONE 'Asia/Makassar')::date;

  SELECT id, clocked_in_at INTO v_id, v_clocked_in_at
    FROM public.classroom_teachers_attendances
    WHERE classroom_teacher_id = p_classroom_teacher_id AND session_date = v_session_date;

  IF v_id IS NULL OR v_clocked_in_at IS NULL THEN
    RAISE EXCEPTION 'Belum absen masuk untuk kelas ini hari ini';
  END IF;

  IF v_is_flexi_hours THEN
    v_recorded_at := COALESCE(p_at, now());

    IF v_recorded_at > now() + interval '1 minute' THEN
      RAISE EXCEPTION 'Waktu selesai tidak boleh melebihi waktu sekarang';
    END IF;
    IF (v_recorded_at AT TIME ZONE 'Asia/Makassar')::date <> v_session_date THEN
      RAISE EXCEPTION 'Waktu selesai harus hari ini';
    END IF;
  ELSE
    IF p_at IS NOT NULL THEN
      RAISE EXCEPTION 'Waktu hanya bisa dipilih untuk jadwal fleksibel';
    END IF;

    v_scheduled_end := (v_session_date::text || ' ' || v_time_end::text)::timestamp
      AT TIME ZONE 'Asia/Makassar';

    IF now() < v_scheduled_end - interval '5 minutes' THEN
      RAISE EXCEPTION 'Belum waktunya absen selesai (mulai 5 menit sebelum jadwal kelas berakhir)';
    END IF;

    v_recorded_at := CASE
      WHEN now() <= v_scheduled_end + interval '5 minutes' THEN v_scheduled_end
      ELSE now()
    END;
  END IF;

  PERFORM set_config('app.work_sessions_managed', 'on', true);

  IF v_is_flexi_hours THEN
    PERFORM public.materialize_flexi_work_session(v_id);

    SELECT id, started_at INTO v_open_session_id, v_open_session_start
      FROM public.classroom_teacher_work_sessions
      WHERE attendance_id = v_id AND ended_at IS NULL;

    -- Nothing running: the day is already finished and this is a double-tap. Left alone rather
    -- than reopened — Lanjutkan is the button that starts the next session.
    IF v_open_session_id IS NULL THEN
      PERFORM set_config('app.work_sessions_managed', '', true);
      RETURN v_id;
    END IF;

    -- A picked time can land before the session began; refuse it rather than record a negative
    -- (or silently zero-length) stretch of work.
    IF v_recorded_at < v_open_session_start THEN
      RAISE EXCEPTION 'Waktu selesai tidak boleh sebelum waktu mulai sesi ini (%)',
        to_char(v_open_session_start AT TIME ZONE 'Asia/Makassar', 'HH24:MI');
    END IF;

    UPDATE public.classroom_teacher_work_sessions
      SET ended_at = v_recorded_at
      WHERE id = v_open_session_id;
  END IF;

  -- Idempotent, same reasoning as clock-in: COALESCE leaves an existing clock-out untouched. On a
  -- resumed flexi day clocked_out_at was set back to NULL when the session opened, so this records
  -- the new finish rather than keeping the morning's.
  UPDATE public.classroom_teachers_attendances
    SET clocked_out_at = COALESCE(clocked_out_at, v_recorded_at),
        clocked_out_source = COALESCE(clocked_out_source, 'teacher')
    WHERE id = v_id;

  -- Lowered again on the way out, not left raised for whatever else shares this transaction.
  PERFORM set_config('app.work_sessions_managed', '', true);

  RETURN v_id;
END;
$function$;

COMMENT ON FUNCTION public.clock_out_classroom_teacher(uuid, timestamptz) IS
  'Selesaikan Kelas / Selesai. p_at (flexi-hours only) is the time the teacher picked; NULL = now().';

GRANT EXECUTE ON FUNCTION public.clock_out_classroom_teacher(uuid, timestamptz) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
