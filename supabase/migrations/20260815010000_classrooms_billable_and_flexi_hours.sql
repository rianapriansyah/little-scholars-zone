-- Hourly work logging for roles that aren't paid classroom teaching (classroom cleaning duty,
-- content creation) reuses the classroom system wholesale rather than building a parallel one:
-- a classroom with is_billable = false is a "program" nobody pays for, but every existing piece
-- (classroom_teachers assignment, classroom_teachers_attendances, the two clock-in/out RPCs, the
-- admin roster, the monthly pay-estimate PDF) already works per classroom-teacher-pair without
-- any further changes. See the two seed rows below.
--
-- is_flexi_hours is the one behavioural fork this needs: a classroom flagged flexi has no real
-- schedule to clock in/out against (content creation can happen any time, any day), so both RPCs
-- skip their window checks entirely for it, and the status view stops trying to compute
-- arrival/departure flags against a schedule that isn't real.

ALTER TABLE public.classrooms ADD COLUMN is_billable boolean NOT NULL DEFAULT true;
ALTER TABLE public.classrooms ADD COLUMN is_flexi_hours boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.classrooms.is_billable IS
  'true = a real fee-paying class a family enrolls a child into (the historical, and still '
  'default, meaning of a classroom row). false = an internal work program nobody pays for '
  '(cleaning duty, content creation) that only exists so teachers/staff can clock in/out of it '
  'through the same mechanism as real teaching. Every "what programs can a family enroll into" '
  'query (list_active_programs, fetchActiveClassrooms, the admin classroom count) must filter '
  'on this — a non-billable program must never be offered as something to enroll a child in.';

COMMENT ON COLUMN public.classrooms.is_flexi_hours IS
  'true = this classroom/program has no real schedule to clock in/out against — '
  'clock_in_classroom_teacher/clock_out_classroom_teacher skip their time-window checks '
  'entirely, and classroom_teachers_attendance_status reports arrival_status/departure_status '
  'as ''not_applicable'' rather than computing lateness against a nominal time_start/time_end. '
  'time_start/time_end are still required (NOT NULL) and still shown for display, but not '
  'enforced. Piket Kebersihan Kelas stays false (it has a real 07:00-08:00 window); Pembuatan '
  'Konten is true.';

-- Both are created with no children ever enrolled and are reached by teachers/staff the same
-- way any classroom is: assigned via classroom_teachers from the admin's classroom-assignment
-- screen. price is 0 (not meaningful — is_billable false means nothing is ever charged for
-- these), guaranteed_days keeps its default (also not meaningful, never read since no
-- learning_periods row is ever created against a non-billable classroom).
INSERT INTO public.classrooms (label, time_start, time_end, price, is_billable, is_flexi_hours)
VALUES
  ('Piket Kebersihan Kelas', '07:00', '08:00', 0, false, false),
  ('Pembuatan Konten', '08:00', '17:00', 0, false, true);

-- ---------------------------------------------------------------------------
-- list_active_programs: the public registration wizard's classroom list. Must never surface a
-- non-billable program as something a parent can enroll a child into.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_active_programs()
RETURNS TABLE (
  id uuid,
  label text,
  time_start time,
  time_end time,
  price numeric,
  guaranteed_days smallint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT c.id, c.label, c.time_start, c.time_end, c.price, c.guaranteed_days
  FROM public.classrooms c
  WHERE c.active AND c.is_billable
  ORDER BY c.label;
$$;

-- ---------------------------------------------------------------------------
-- clock_in_classroom_teacher / clock_out_classroom_teacher: add the is_flexi_hours bypass.
-- Everything else (authorisation, idempotency, the on-time normalisation for a real schedule)
-- is copied unchanged from 20260811010000_clock_out_overtime_grace.sql.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.clock_in_classroom_teacher(p_classroom_teacher_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_teacher_id uuid;
  v_time_start time;
  v_is_flexi_hours boolean;
  v_session_date date;
  v_scheduled_start timestamptz;
  v_recorded_at timestamptz;
  v_id uuid;
BEGIN
  SELECT t.id, c.time_start, c.is_flexi_hours
    INTO v_teacher_id, v_time_start, v_is_flexi_hours
    FROM public.classroom_teachers ct
    JOIN public.teachers t ON t.id = ct.teacher_id
    JOIN public.classrooms c ON c.id = ct.classroom_id
    WHERE ct.id = p_classroom_teacher_id
      AND t.auth_user_id = auth.uid();

  IF v_teacher_id IS NULL THEN
    RAISE EXCEPTION 'Not authorised to clock in for this class';
  END IF;

  v_session_date := (now() AT TIME ZONE 'Asia/Makassar')::date;

  IF v_is_flexi_hours THEN
    -- No schedule to validate or normalise against — any time, any day.
    v_recorded_at := now();
  ELSE
    v_scheduled_start := (v_session_date::text || ' ' || v_time_start::text)::timestamp
      AT TIME ZONE 'Asia/Makassar';

    IF now() < v_scheduled_start - interval '5 minutes' THEN
      RAISE EXCEPTION 'Belum waktunya absen masuk (mulai 5 menit sebelum jadwal kelas dimulai)';
    END IF;

    v_recorded_at := CASE
      WHEN now() <= v_scheduled_start + interval '5 minutes' THEN v_scheduled_start
      ELSE now()
    END;
  END IF;

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
  v_is_flexi_hours boolean;
  v_session_date date;
  v_scheduled_end timestamptz;
  v_recorded_at timestamptz;
  v_id uuid;
  v_clocked_in_at timestamptz;
BEGIN
  SELECT t.id, c.time_end, c.is_flexi_hours
    INTO v_teacher_id, v_time_end, v_is_flexi_hours
    FROM public.classroom_teachers ct
    JOIN public.teachers t ON t.id = ct.teacher_id
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
    v_recorded_at := now();
  ELSE
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

  -- Idempotent, same reasoning as clock-in: COALESCE leaves an existing clock-out untouched.
  UPDATE public.classroom_teachers_attendances
    SET clocked_out_at = COALESCE(clocked_out_at, v_recorded_at),
        clocked_out_source = COALESCE(clocked_out_source, 'teacher')
    WHERE id = v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clock_in_classroom_teacher(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clock_out_classroom_teacher(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- classroom_teachers_attendance_status: is_flexi_hours rows report 'not_applicable' for
-- arrival_status/departure_status instead of computing lateness against a schedule that isn't
-- real. A sentinel value, not NULL — parseClassroomTeacherAttendanceStatus on the client treats
-- a null arrival_status/departure_status as a malformed row and drops it entirely, which would
-- silently hide every flexi-hours punch from the teacher's own card and the admin roster alike.
-- scheduled_start/scheduled_end stay computed either way — still informative to display even
-- when not enforced.
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
    WHEN c.is_flexi_hours THEN 'not_applicable'
    WHEN ta.clocked_in_at IS NULL THEN 'missing'
    WHEN ta.clocked_in_at > (ta.session_date::text || ' ' || c.time_start::text)::timestamp
      AT TIME ZONE 'Asia/Makassar' + interval '5 minutes' THEN 'late'
    ELSE 'on_time'
  END AS arrival_status,
  CASE
    WHEN c.is_flexi_hours THEN 'not_applicable'
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
  'classrooms''/classroom_teachers'' RLS policies apply to readers of the view. Both statuses '
  'read ''not_applicable'' for an is_flexi_hours classroom (Pembuatan Konten) — there is no real '
  'schedule to be late or early against there.';
