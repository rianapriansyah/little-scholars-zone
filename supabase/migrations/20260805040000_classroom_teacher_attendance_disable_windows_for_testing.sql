-- TEMPORARY, for testing: removes the 5-minute clock-in/out window enforcement so the Masuk
-- Kelas / Selesaikan Kelas buttons can be exercised at any time. Everything else (auth check,
-- idempotency) is unchanged. Re-add the window checks from
-- 20260805030000_classroom_teachers_attendances.sql before relying on this for real punctuality
-- tracking — that migration is the reference version to restore.

CREATE OR REPLACE FUNCTION public.clock_in_classroom_teacher(p_classroom_teacher_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_teacher_id uuid;
  v_session_date date;
  v_id uuid;
BEGIN
  SELECT t.id
    INTO v_teacher_id
    FROM public.classroom_teachers ct
    JOIN public.teachers t ON t.id = ct.teacher_id
    WHERE ct.id = p_classroom_teacher_id
      AND t.auth_user_id = auth.uid();

  IF v_teacher_id IS NULL THEN
    RAISE EXCEPTION 'Not authorised to clock in for this class';
  END IF;

  v_session_date := (now() AT TIME ZONE 'Asia/Makassar')::date;

  -- Idempotent: a second tap must not shift an already-recorded time.
  INSERT INTO public.classroom_teachers_attendances (classroom_teacher_id, session_date, clocked_in_at, clocked_in_source)
  VALUES (p_classroom_teacher_id, v_session_date, now(), 'teacher')
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
  v_session_date date;
  v_id uuid;
  v_clocked_in_at timestamptz;
BEGIN
  SELECT t.id
    INTO v_teacher_id
    FROM public.classroom_teachers ct
    JOIN public.teachers t ON t.id = ct.teacher_id
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

  -- Idempotent, same reasoning as clock-in: COALESCE leaves an existing clock-out untouched.
  UPDATE public.classroom_teachers_attendances
    SET clocked_out_at = COALESCE(clocked_out_at, now()),
        clocked_out_source = COALESCE(clocked_out_source, 'teacher')
    WHERE id = v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clock_in_classroom_teacher(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clock_out_classroom_teacher(uuid) TO authenticated, service_role;
