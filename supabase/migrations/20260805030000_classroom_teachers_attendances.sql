-- Teacher attendance tracker: how many minutes a teacher actually spent teaching a class,
-- for payroll and punctuality tracking. Payroll math itself stays manual for now — this table
-- only produces the clean clock-in/out data an admin reads to compute it.
--
-- One row per (classroom_teacher, session_date), mirroring child_attendances' one-row-per-day
-- shape. A teacher clocks themselves in/out through two SECURITY DEFINER RPCs that re-validate
-- a 5-minute window against the classroom's scheduled time server-side; an admin corrects or
-- backfills a missed punch with a plain table write (they have full RLS access already).
--
-- Deliberately NO teacher INSERT/UPDATE RLS policy, unlike child_attendances. The RPCs are the
-- only teacher-facing write path specifically so the time window can't be bypassed by writing
-- to the table directly — a raw insert/update from the teacher's session would let them record
-- any timestamp they like.

CREATE TABLE public.classroom_teachers_attendances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_teacher_id uuid NOT NULL REFERENCES public.classroom_teachers(id),
  session_date date NOT NULL,

  clocked_in_at timestamptz,
  clocked_in_source text CHECK (clocked_in_source IN ('teacher', 'admin')),
  clocked_out_at timestamptz,
  clocked_out_source text CHECK (clocked_out_source IN ('teacher', 'admin')),

  -- Set whenever an admin touches a row after its initial creation, so the correction is
  -- visible even when clocked_in_source/clocked_out_source still read 'teacher'.
  edited_by uuid REFERENCES auth.users(id),
  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT classroom_teachers_attendances_key UNIQUE (classroom_teacher_id, session_date),
  CONSTRAINT classroom_teachers_attendances_out_needs_in
    CHECK (clocked_out_at IS NULL OR clocked_in_at IS NOT NULL),
  CONSTRAINT classroom_teachers_attendances_out_after_in
    CHECK (clocked_out_at IS NULL OR clocked_out_at > clocked_in_at)
);

COMMENT ON TABLE public.classroom_teachers_attendances IS
  'One row per classroom_teacher per date: when the teacher actually clocked in/out, versus '
  'the classroom''s scheduled time_start/time_end. No row means nobody has logged that class '
  'for that date yet — same "absence of a row means nothing happened" convention as '
  'child_attendances.';

COMMENT ON COLUMN public.classroom_teachers_attendances.clocked_in_source IS
  '''teacher'' when logged via clock_in_classroom_teacher() inside the 5-minute window; '''
  '''admin'' when an admin filled in a missed punch or corrected one.';

COMMENT ON COLUMN public.classroom_teachers_attendances.notes IS
  'Admin''s reason for a manual fill-in or correction. Never set by the teacher-facing RPCs.';

CREATE INDEX classroom_teachers_attendances_classroom_teacher_id_idx
  ON public.classroom_teachers_attendances (classroom_teacher_id);
CREATE INDEX classroom_teachers_attendances_session_date_idx
  ON public.classroom_teachers_attendances (session_date);

GRANT ALL ON public.classroom_teachers_attendances TO authenticated, service_role;
ALTER TABLE public.classroom_teachers_attendances ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_all_classroom_teachers_attendances ON public.classroom_teachers_attendances FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- teacher_classroom_teacher_ids is the existing SECURITY DEFINER helper from
-- 20260726030000_classroom_multi_teacher.sql. Read-only: see the file comment for why there is
-- no matching INSERT/UPDATE policy.
CREATE POLICY teacher_select_own_classroom_teachers_attendances ON public.classroom_teachers_attendances FOR SELECT
  USING (classroom_teacher_id IN (SELECT public.teacher_classroom_teacher_ids(auth.uid())));

-- ---------------------------------------------------------------------------
-- Derived values: computed in the view, never stored, same reasoning as learning_period_status.
-- ---------------------------------------------------------------------------

CREATE VIEW public.classroom_teachers_attendance_status
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
    ELSE 'on_time'
  END AS departure_status
FROM public.classroom_teachers_attendances ta
JOIN public.classroom_teachers ct ON ct.id = ta.classroom_teacher_id
JOIN public.classrooms c ON c.id = ct.classroom_id;

COMMENT ON VIEW public.classroom_teachers_attendance_status IS
  'classroom_teachers_attendances plus the scheduled instants and flags derived from them. '
  'arrival_status/departure_status are flags only, never used to dock pay — payroll stays a '
  'manual process an admin runs off this data. security_invoker so the base table''s and '
  'classrooms''/classroom_teachers'' RLS policies apply to readers of the view.';

GRANT SELECT ON public.classroom_teachers_attendance_status TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Write path: teacher self-clock, server-enforced window.
-- ---------------------------------------------------------------------------

-- Masuk Kelas. Only within 5 minutes either side of the classroom's scheduled start time,
-- judged in WITA against the WITA calendar date — mirrors getTodaysClassStartInWita() on the
-- client, which is what the button's enabled/disabled state is computed from, but this is the
-- check that actually matters since the client can't be trusted.
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

  IF now() < v_scheduled_start - interval '5 minutes'
     OR now() > v_scheduled_start + interval '5 minutes' THEN
    RAISE EXCEPTION 'Di luar jendela absen masuk (5 menit sebelum sampai 5 menit sesudah kelas dimulai)';
  END IF;

  -- Idempotent: a second tap inside the window must not shift an already-recorded time.
  INSERT INTO public.classroom_teachers_attendances (classroom_teacher_id, session_date, clocked_in_at, clocked_in_source)
  VALUES (p_classroom_teacher_id, v_session_date, now(), 'teacher')
  ON CONFLICT ON CONSTRAINT classroom_teachers_attendances_key DO NOTHING;

  SELECT id INTO v_id
    FROM public.classroom_teachers_attendances
    WHERE classroom_teacher_id = p_classroom_teacher_id AND session_date = v_session_date;

  RETURN v_id;
END;
$$;

-- Selesaikan Kelas. Only opens 5 minutes before the scheduled end time — no upper bound, since
-- a class legitimately running long must still be closeable whenever it actually finishes.
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
