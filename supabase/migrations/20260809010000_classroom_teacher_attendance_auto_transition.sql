-- Automatic clock-out/clock-in across back-to-back classes. A teacher who runs a contiguous
-- block (e.g. 08:00-10:00 then 10:00-12:00, no gap) only clocks in for the first class; when it
-- ends, the app itself closes it and opens the next one — nothing for the teacher to tap at the
-- boundary. See buildContiguousChainLinks in src/lib/classroomTeacherAttendance.ts for how the
-- client decides which classes chain together; this RPC is what actually re-validates and
-- performs the transition, so a client bug can never chain classes that don't really run
-- back-to-back.

-- 'auto' is a third, honest provenance value distinct from 'teacher' (a real tap) and 'admin'
-- (a correction) — this is neither, it's the system acting on the teacher's behalf because the
-- schedule left no gap for them to act in.
ALTER TABLE public.classroom_teachers_attendances
  DROP CONSTRAINT classroom_teachers_attendances_clocked_in_source_check,
  ADD CONSTRAINT classroom_teachers_attendances_clocked_in_source_check
    CHECK (clocked_in_source IN ('teacher', 'admin', 'auto'));

ALTER TABLE public.classroom_teachers_attendances
  DROP CONSTRAINT classroom_teachers_attendances_clocked_out_source_check,
  ADD CONSTRAINT classroom_teachers_attendances_clocked_out_source_check
    CHECK (clocked_out_source IN ('teacher', 'admin', 'auto'));

CREATE OR REPLACE FUNCTION public.auto_transition_classroom_teacher(
  p_from_classroom_teacher_id uuid,
  p_to_classroom_teacher_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_teacher_id uuid;
  v_to_teacher_id uuid;
  v_from_time_end time;
  v_to_time_start time;
  v_session_date date;
  v_scheduled_from_end timestamptz;
  v_from_id uuid;
  v_from_clocked_in_at timestamptz;
  v_to_id uuid;
BEGIN
  -- Both classes must belong to the same caller — this can never be used to chain (or peek at)
  -- another teacher's schedule.
  SELECT t.id, c.time_end
    INTO v_teacher_id, v_from_time_end
    FROM public.classroom_teachers ct
    JOIN public.teachers t ON t.id = ct.teacher_id
    JOIN public.classrooms c ON c.id = ct.classroom_id
    WHERE ct.id = p_from_classroom_teacher_id
      AND t.auth_user_id = auth.uid();

  IF v_teacher_id IS NULL THEN
    RAISE EXCEPTION 'Not authorised for the source class';
  END IF;

  SELECT t.id, c.time_start
    INTO v_to_teacher_id, v_to_time_start
    FROM public.classroom_teachers ct
    JOIN public.teachers t ON t.id = ct.teacher_id
    JOIN public.classrooms c ON c.id = ct.classroom_id
    WHERE ct.id = p_to_classroom_teacher_id
      AND t.auth_user_id = auth.uid();

  IF v_to_teacher_id IS NULL OR v_to_teacher_id <> v_teacher_id THEN
    RAISE EXCEPTION 'Not authorised for the destination class';
  END IF;

  -- The server independently confirms the two classes are genuinely back-to-back, rather than
  -- trusting the client's pairing.
  IF v_from_time_end IS DISTINCT FROM v_to_time_start THEN
    RAISE EXCEPTION 'Classes are not back-to-back; cannot auto-transition';
  END IF;

  v_session_date := (now() AT TIME ZONE 'Asia/Makassar')::date;
  v_scheduled_from_end := (v_session_date::text || ' ' || v_from_time_end::text)::timestamp
    AT TIME ZONE 'Asia/Makassar';

  -- Never lets the transition happen before the source class has actually finished, even if
  -- the caller's clock is fast.
  IF now() < v_scheduled_from_end THEN
    RAISE EXCEPTION 'Belum waktunya transisi otomatis ke kelas berikutnya';
  END IF;

  SELECT id, clocked_in_at INTO v_from_id, v_from_clocked_in_at
    FROM public.classroom_teachers_attendances
    WHERE classroom_teacher_id = p_from_classroom_teacher_id AND session_date = v_session_date;

  IF v_from_id IS NULL OR v_from_clocked_in_at IS NULL THEN
    RAISE EXCEPTION 'Belum absen masuk untuk kelas sebelumnya';
  END IF;

  -- Close the source class — idempotent, same COALESCE reasoning as clock_out_classroom_teacher.
  UPDATE public.classroom_teachers_attendances
    SET clocked_out_at = COALESCE(clocked_out_at, now()),
        clocked_out_source = COALESCE(clocked_out_source, 'auto')
    WHERE id = v_from_id;

  -- Open the destination class — idempotent, same ON CONFLICT DO NOTHING reasoning as
  -- clock_in_classroom_teacher.
  INSERT INTO public.classroom_teachers_attendances (classroom_teacher_id, session_date, clocked_in_at, clocked_in_source)
  VALUES (p_to_classroom_teacher_id, v_session_date, now(), 'auto')
  ON CONFLICT ON CONSTRAINT classroom_teachers_attendances_key DO NOTHING;

  SELECT id INTO v_to_id
    FROM public.classroom_teachers_attendances
    WHERE classroom_teacher_id = p_to_classroom_teacher_id AND session_date = v_session_date;

  RETURN v_to_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_transition_classroom_teacher(uuid, uuid) TO authenticated, service_role;
