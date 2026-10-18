-- Creating, cancelling and discovering coverage. All SECURITY DEFINER, because every one of them
-- has to read across teachers the caller cannot see: `teachers` has only teacher_select_own_profile,
-- so a teacher can never read another teacher's name through RLS, and classroom_teachers is
-- restricted to her own groups. Without these RPCs a "Pengganti Bu Rina" label is simply not
-- expressible on the client, and a teacher has no way to discover which group she needs to cover.
--
-- Two creation paths, as the owner asked for: an admin assigns coverage (any date, planned leave
-- included), and a covering teacher declares it herself on the day when no admin is around. They
-- are separate functions rather than one with a role branch, because the rules genuinely differ —
-- the teacher path is fenced in, the admin path is not — and a single function would have to say
-- so with an `IF v_is_admin` around half its body.
--
-- declare_substitution takes NO date parameter on purpose. The server uses today in WITA, so a
-- teacher cannot quietly backdate coverage to reopen a day she should no longer be writing to.
-- Backdating is an admin action.

-- ---------------------------------------------------------------------------
-- The pay rule, in one place
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.default_counts_for_pay(
  p_classroom_teacher_id uuid,
  p_substitute_teacher_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  -- Already holds a group in the same classroom => already in that room for that hour, already
  -- paid for it, so covering a second group there earns nothing extra. Otherwise she came in from
  -- outside and is paid at that classroom's rate.
  SELECT NOT EXISTS (
    SELECT 1
    FROM public.classroom_teachers mine
    JOIN public.classroom_teachers covered ON covered.id = p_classroom_teacher_id
    WHERE mine.classroom_id = covered.classroom_id
      AND mine.teacher_id = p_substitute_teacher_id
  );
$$;

COMMENT ON FUNCTION public.default_counts_for_pay(uuid, uuid) IS
  'The owner''s rule for whether coverage is payable: false when the substitute already holds a '
  'group in the covered classroom, true otherwise. The single definition of that rule — both '
  'creation RPCs and the admin UI''s preview read it, so they cannot disagree. The physically '
  'meaningful question is whether she was already being paid for that time slot, and '
  'same-classroom is its common case; admin override covers the rest.';

GRANT EXECUTE ON FUNCTION public.default_counts_for_pay(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Teacher self-declaration
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.declare_substitution(
  p_classroom_teacher_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_teacher_id uuid;
  v_session_date date;
  v_classroom_id uuid;
  v_assigned_teacher_id uuid;
  v_time_start time;
  v_time_end time;
  v_is_flexi_hours boolean;
  v_active boolean;
  v_scheduled_start timestamptz;
  v_existing_id uuid;
  v_existing_substitute uuid;
  v_id uuid;
BEGIN
  SELECT t.id INTO v_teacher_id
    FROM public.teachers t
    WHERE t.auth_user_id = auth.uid() AND t.active;
  IF v_teacher_id IS NULL THEN
    RAISE EXCEPTION 'Hanya guru aktif yang bisa menggantikan kelas';
  END IF;

  SELECT ct.classroom_id, ct.teacher_id, c.time_start, c.time_end, c.is_flexi_hours, c.active
    INTO v_classroom_id, v_assigned_teacher_id, v_time_start, v_time_end, v_is_flexi_hours, v_active
    FROM public.classroom_teachers ct
    JOIN public.classrooms c ON c.id = ct.classroom_id
    WHERE ct.id = p_classroom_teacher_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kelas tidak ditemukan';
  END IF;

  IF NOT v_active THEN
    RAISE EXCEPTION 'Kelas ini sudah tidak aktif';
  END IF;

  -- The trigger would catch this too, but a named message is kinder than a constraint error.
  IF v_assigned_teacher_id = v_teacher_id THEN
    RAISE EXCEPTION 'Ini kelas Anda sendiri, tidak perlu pengganti';
  END IF;

  v_session_date := (now() AT TIME ZONE 'Asia/Makassar')::date;

  -- A flexi-hours class has no schedule to judge a day or a window against — see
  -- clock_in_classroom_teacher, which skips the same two checks for the same reason.
  IF NOT v_is_flexi_hours THEN
    IF extract(isodow FROM v_session_date) > 5 THEN
      RAISE EXCEPTION 'Kelas hanya berjalan hari Senin sampai Jumat';
    END IF;

    v_scheduled_start := (v_session_date::text || ' ' || v_time_start::text)::timestamp
      AT TIME ZONE 'Asia/Makassar';

    -- Same floor as clocking in. No upper bound inside the day: filing coverage after the class
    -- has finished is normal, because she was busy teaching it.
    IF now() < v_scheduled_start - interval '60 minutes' THEN
      RAISE EXCEPTION 'Belum waktunya menggantikan kelas ini (mulai 1 jam sebelum jadwal kelas dimulai)';
    END IF;
  END IF;

  -- Idempotent for the same substitute (a double tap is harmless), but never a takeover.
  SELECT s.id, s.substitute_teacher_id INTO v_existing_id, v_existing_substitute
    FROM public.classroom_teachers_substitutions s
    WHERE s.classroom_teacher_id = p_classroom_teacher_id
      AND s.session_date = v_session_date;

  IF v_existing_id IS NOT NULL THEN
    IF v_existing_substitute = v_teacher_id THEN
      RETURN v_existing_id;
    END IF;
    RAISE EXCEPTION 'Kelas ini sudah digantikan guru lain hari ini';
  END IF;

  -- The assigned teacher must genuinely be absent. If she has already clocked in she is standing
  -- right there, and this is not a coverage situation. An admin can still assign one.
  IF EXISTS (
    SELECT 1
    FROM public.classroom_teachers_attendances ta
    WHERE ta.classroom_teacher_id = p_classroom_teacher_id
      AND ta.session_date = v_session_date
      AND ta.clocked_in_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Guru kelas ini sudah absen masuk hari ini';
  END IF;

  -- She cannot be in two rooms at once: refuse a class whose schedule overlaps one she already
  -- holds today, as her own group or as another coverage. Flexi-hours classes have no meaningful
  -- schedule, so they are left out of the comparison on both sides.
  IF NOT v_is_flexi_hours AND EXISTS (
    SELECT 1
    FROM public.classrooms other
    WHERE other.id <> v_classroom_id
      AND NOT other.is_flexi_hours
      AND other.time_start < v_time_end
      AND other.time_end > v_time_start
      AND EXISTS (
        SELECT 1
        FROM public.classroom_teachers ct2
        WHERE ct2.classroom_id = other.id
          AND (
            ct2.teacher_id = v_teacher_id
            OR EXISTS (
              SELECT 1
              FROM public.classroom_teachers_substitutions s2
              WHERE s2.classroom_teacher_id = ct2.id
                AND s2.session_date = v_session_date
                AND s2.substitute_teacher_id = v_teacher_id
            )
          )
      )
  ) THEN
    RAISE EXCEPTION 'Jadwal kelas ini bentrok dengan kelas Anda yang lain hari ini';
  END IF;

  INSERT INTO public.classroom_teachers_substitutions (
    classroom_teacher_id, substitute_teacher_id, session_date,
    counts_for_pay, created_by_role, reason, created_by
  )
  VALUES (
    p_classroom_teacher_id, v_teacher_id, v_session_date,
    public.default_counts_for_pay(p_classroom_teacher_id, v_teacher_id),
    'teacher', NULLIF(btrim(p_reason), ''), auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.declare_substitution(uuid, text) IS
  'A teacher declares that she is covering another teacher''s group TODAY (WITA — there is no date '
  'parameter, so coverage cannot be backdated). Refuses unless she is an active teacher, the class '
  'is active, it is not her own group, it is a class day within the clock-in window, nobody else '
  'already covers it, the assigned teacher has not clocked in, and it does not clash with another '
  'class she holds today. Idempotent for the same substitute.';

GRANT EXECUTE ON FUNCTION public.declare_substitution(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Admin assignment and cancellation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assign_substitution(
  p_classroom_teacher_id uuid,
  p_substitute_teacher_id uuid,
  p_session_date date,
  p_counts_for_pay boolean DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF (auth.jwt() -> 'app_metadata' ->> 'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only an admin can assign a substitute teacher';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.classroom_teachers WHERE id = p_classroom_teacher_id) THEN
    RAISE EXCEPTION 'Classroom/teacher assignment not found';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.teachers WHERE id = p_substitute_teacher_id AND active) THEN
    RAISE EXCEPTION 'Substitute teacher not found or inactive';
  END IF;

  -- Deliberately none of declare_substitution's situational rules: an admin books planned leave in
  -- advance, fixes a record days later, and knows when the schedule is unusual. The two invariants
  -- that are about data integrity rather than situation still hold — the self-substitution trigger,
  -- and one substitute per group per day via the unique constraint, surfaced here as an update so
  -- re-assigning a day is not an error.
  INSERT INTO public.classroom_teachers_substitutions (
    classroom_teacher_id, substitute_teacher_id, session_date,
    counts_for_pay, created_by_role, reason, created_by
  )
  VALUES (
    p_classroom_teacher_id, p_substitute_teacher_id, p_session_date,
    COALESCE(p_counts_for_pay, public.default_counts_for_pay(p_classroom_teacher_id, p_substitute_teacher_id)),
    'admin', NULLIF(btrim(p_reason), ''), auth.uid()
  )
  ON CONFLICT ON CONSTRAINT classroom_teachers_substitutions_group_date_key
  DO UPDATE SET
    substitute_teacher_id = EXCLUDED.substitute_teacher_id,
    counts_for_pay = EXCLUDED.counts_for_pay,
    created_by_role = EXCLUDED.created_by_role,
    reason = EXCLUDED.reason,
    created_by = EXCLUDED.created_by
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.assign_substitution(uuid, uuid, date, boolean, text) IS
  'Admin-only. Records that one teacher covers a group on a date, for any date including planned '
  'leave booked ahead. p_counts_for_pay NULL means "use default_counts_for_pay"; passing it '
  'explicitly is the admin override. Re-assigning the same group and date replaces the existing '
  'record rather than failing.';

GRANT EXECUTE ON FUNCTION public.assign_substitution(uuid, uuid, date, boolean, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cancel_substitution(p_substitution_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_classroom_teacher_id uuid;
  v_session_date date;
  v_counts_for_pay boolean;
BEGIN
  IF (auth.jwt() -> 'app_metadata' ->> 'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only an admin can cancel a substitute teacher record';
  END IF;

  SELECT classroom_teacher_id, session_date, counts_for_pay
    INTO v_classroom_teacher_id, v_session_date, v_counts_for_pay
    FROM public.classroom_teachers_substitutions
    WHERE id = p_substitution_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Substitution not found';
  END IF;

  -- A payable coverage day whose clock-in has already been recorded is the substitute's pay.
  -- Removing the record would leave that punch attributed to the absent teacher with nothing to
  -- explain it, so the clock-in has to be dealt with first.
  IF v_counts_for_pay AND EXISTS (
    SELECT 1
    FROM public.classroom_teachers_attendances ta
    WHERE ta.classroom_teacher_id = v_classroom_teacher_id
      AND ta.session_date = v_session_date
      AND ta.clocked_in_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Absen kelas untuk hari ini sudah tercatat — hapus absen kelasnya dulu sebelum membatalkan guru pengganti';
  END IF;

  DELETE FROM public.classroom_teachers_substitutions WHERE id = p_substitution_id;
END;
$$;

COMMENT ON FUNCTION public.cancel_substitution(uuid) IS
  'Admin-only. Removes a coverage record, refusing when the day is payable and a clock-in has '
  'already been recorded for it — that punch would otherwise be silently re-attributed to the '
  'absent teacher.';

GRANT EXECUTE ON FUNCTION public.cancel_substitution(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Discovery
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.my_teaching_groups_for_date(p_date date)
RETURNS TABLE (
  classroom_teacher_id uuid,
  classroom_id uuid,
  label text,
  time_start time,
  time_end time,
  is_substitute boolean,
  assigned_teacher_full_name text,
  assigned_teacher_call_name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH me AS (
    SELECT t.id FROM public.teachers t WHERE t.auth_user_id = auth.uid()
  )
  SELECT ct.id, ct.classroom_id, c.label, c.time_start, c.time_end,
         false, NULL::text, NULL::text
  FROM public.classroom_teachers ct
  JOIN public.classrooms c ON c.id = ct.classroom_id
  WHERE ct.teacher_id IN (SELECT id FROM me)

  UNION ALL

  -- The absent teacher's name comes back so the class can be labelled "Pengganti Bu Rina". It is
  -- the one thing here the client cannot read for itself: `teachers` exposes only own profile.
  SELECT ct.id, ct.classroom_id, c.label, c.time_start, c.time_end,
         true, assigned.full_name, assigned.call_name
  FROM public.classroom_teachers_substitutions s
  JOIN public.classroom_teachers ct ON ct.id = s.classroom_teacher_id
  JOIN public.classrooms c ON c.id = ct.classroom_id
  LEFT JOIN public.teachers assigned ON assigned.id = ct.teacher_id
  WHERE s.substitute_teacher_id IN (SELECT id FROM me)
    AND s.session_date = p_date

  ORDER BY time_start, label;
$$;

COMMENT ON FUNCTION public.my_teaching_groups_for_date(date) IS
  'Every group the calling teacher is responsible for on one date: her own assignments plus any '
  'group she is covering that day, flagged with is_substitute and the absent teacher''s name. '
  'Replaces the client''s classroom_teachers query on Laporan Harian and Kelas Saya, because '
  'coverage is per-date and the absent teacher''s name is unreadable through RLS.';

GRANT EXECUTE ON FUNCTION public.my_teaching_groups_for_date(date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.substitutable_groups_today()
RETURNS TABLE (
  classroom_teacher_id uuid,
  classroom_id uuid,
  label text,
  time_start time,
  time_end time,
  assigned_teacher_full_name text,
  assigned_teacher_call_name text,
  already_covered boolean,
  assigned_teacher_clocked_in boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH me AS (
    SELECT t.id FROM public.teachers t WHERE t.auth_user_id = auth.uid() AND t.active
  ),
  today AS (
    SELECT (now() AT TIME ZONE 'Asia/Makassar')::date AS d
  )
  SELECT ct.id, ct.classroom_id, c.label, c.time_start, c.time_end,
         assigned.full_name, assigned.call_name,
         EXISTS (
           SELECT 1 FROM public.classroom_teachers_substitutions s
           WHERE s.classroom_teacher_id = ct.id AND s.session_date = (SELECT d FROM today)
         ),
         EXISTS (
           SELECT 1 FROM public.classroom_teachers_attendances ta
           WHERE ta.classroom_teacher_id = ct.id
             AND ta.session_date = (SELECT d FROM today)
             AND ta.clocked_in_at IS NOT NULL
         )
  FROM public.classroom_teachers ct
  JOIN public.classrooms c ON c.id = ct.classroom_id
  LEFT JOIN public.teachers assigned ON assigned.id = ct.teacher_id
  WHERE EXISTS (SELECT 1 FROM me)
    AND c.active
    AND ct.teacher_id NOT IN (SELECT id FROM me)
    -- Only classes that have someone to teach: a group with no active children is not a coverage
    -- situation, it is an empty assignment.
    AND EXISTS (
      SELECT 1 FROM public.children_classrooms cc
      WHERE cc.classroom_teacher_id = ct.id AND cc.ended_at IS NULL
    )
  ORDER BY c.time_start, c.label;
$$;

COMMENT ON FUNCTION public.substitutable_groups_today() IS
  'The groups a teacher could offer to cover today: active classes with active children that are '
  'not her own, each flagged with whether someone already covers it and whether its own teacher '
  'has clocked in. Powers the "Gantikan Kelas" picker — a teacher cannot otherwise see other '
  'teachers'' groups at all. The flags are advisory for the UI; declare_substitution re-checks '
  'every rule itself.';

GRANT EXECUTE ON FUNCTION public.substitutable_groups_today() TO authenticated, service_role;
