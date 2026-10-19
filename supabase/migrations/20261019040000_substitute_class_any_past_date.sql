-- Gantikan Kelas gets a date selector: a teacher covers a colleague's class for any date up to and
-- including today (owner request). A class covered on Friday but never filled in can now be caught
-- up on Monday, which the today-only version made impossible — she simply lost the day.
--
-- The three RPCs take the date instead of reading today's, so each gains a parameter. CREATE OR
-- REPLACE cannot add one (it would leave an overload behind, callable with the old argument list
-- and silently applying today), so the old signatures are dropped first.
--
-- FUTURE DATES ARE REFUSED, and that is the one hard limit. Student attendance draws down a child's
-- paid quota, so a record against a day that has not happened yet would bill a family for a class
-- nobody has taught. The past has no limit: a day that happened, happened, and the teacher who
-- covered it is the right person to write it up.
--
-- Which checks still make sense once the date is free:
--   * the Mon–Fri rule applies to any date — classes never ran on a weekend, so there is nothing to
--     have covered;
--   * the "an hour before the class starts" window only applies when the date IS today. On a past
--     date the window closed long ago, and applying it would refuse exactly the catch-up this
--     change exists for;
--   * "the assigned teacher has not clocked in" and "does not clash with another class she held"
--     both move to the chosen date rather than today — they are statements about the day being
--     covered, not about now.
--
-- The submitted-report guard on withdrawing is unchanged in spirit and now per-date: once a parent
-- can see that day's report, its author cannot walk away from it.

DROP FUNCTION IF EXISTS public.substitutable_classes();
DROP FUNCTION IF EXISTS public.declare_substitution(uuid, text);
DROP FUNCTION IF EXISTS public.withdraw_substitution(uuid);

-- ---------------------------------------------------------------------------
-- Discovery, for one date
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.substitutable_classes(p_session_date date)
RETURNS TABLE (
  classroom_teacher_id uuid,
  classroom_id uuid,
  label text,
  time_start time,
  time_end time,
  teacher_id uuid,
  teacher_full_name text,
  teacher_call_name text,
  covered_by_me boolean,
  covered_by_other boolean,
  teacher_clocked_in boolean,
  student_count integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH me AS (
    SELECT t.id FROM public.teachers t WHERE t.auth_user_id = auth.uid() AND t.active
  )
  SELECT
    ct.id,
    ct.classroom_id,
    c.label,
    c.time_start,
    c.time_end,
    ct.teacher_id,
    assigned.full_name,
    assigned.call_name,
    EXISTS (
      SELECT 1 FROM public.classroom_teachers_substitutions s
      WHERE s.classroom_teacher_id = ct.id
        AND s.session_date = p_session_date
        AND s.substitute_teacher_id IN (SELECT id FROM me)
    ),
    EXISTS (
      SELECT 1 FROM public.classroom_teachers_substitutions s
      WHERE s.classroom_teacher_id = ct.id
        AND s.session_date = p_session_date
        AND s.substitute_teacher_id NOT IN (SELECT id FROM me)
    ),
    EXISTS (
      SELECT 1 FROM public.classroom_teachers_attendances ta
      WHERE ta.classroom_teacher_id = ct.id
        AND ta.session_date = p_session_date
        AND ta.clocked_in_at IS NOT NULL
    ),
    (
      -- Enrolment as it stood on that date, not as it stands now: a child who has since moved
      -- group was in this one on the day being covered, and is who the teacher taught.
      SELECT count(*)::int FROM public.children_classrooms cc
      WHERE cc.classroom_teacher_id = ct.id
        AND cc.started_at <= p_session_date
        AND (cc.ended_at IS NULL OR cc.ended_at >= p_session_date)
    )
  FROM public.classroom_teachers ct
  JOIN public.classrooms c ON c.id = ct.classroom_id
  LEFT JOIN public.teachers assigned ON assigned.id = ct.teacher_id
  WHERE EXISTS (SELECT 1 FROM me)
    AND c.active
    -- Billable classes only: a flexi work item (Pembuatan Konten) or Piket Pagi has no students to
    -- take over, so it has no business in a "whose class am I covering" picker.
    AND c.is_billable
    -- Her own groups are not something she stands in for.
    AND ct.teacher_id NOT IN (SELECT id FROM me)
    -- A group with nobody enrolled on that date is an empty assignment, not a class needing cover.
    AND EXISTS (
      SELECT 1 FROM public.children_classrooms cc
      WHERE cc.classroom_teacher_id = ct.id
        AND cc.started_at <= p_session_date
        AND (cc.ended_at IS NULL OR cc.ended_at >= p_session_date)
    )
  ORDER BY c.time_start, c.label, assigned.full_name;
$$;

COMMENT ON FUNCTION public.substitutable_classes(date) IS
  'Every billable, active group that is not the calling teacher''s own and had children enrolled on '
  'p_session_date, with its class, its assigned teacher and that date''s state: whether she already '
  'covers it, whether someone else does, whether its own teacher clocked in, and how many children '
  'were enrolled. Powers both dropdowns on Gantikan Kelas — a teacher cannot see other teachers'' '
  'groups or names through RLS at all. The flags are advisory for the UI; declare_substitution '
  're-checks every rule itself.';

GRANT EXECUTE ON FUNCTION public.substitutable_classes(date) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The Gantikan Kelas button
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.declare_substitution(
  p_classroom_teacher_id uuid,
  p_session_date date,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_teacher_id uuid;
  v_today date;
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

  v_today := (now() AT TIME ZONE 'Asia/Makassar')::date;

  -- The one hard limit. Attendance consumes a paid quota, so a class that has not happened cannot
  -- be covered, written up, or billed for.
  IF p_session_date > v_today THEN
    RAISE EXCEPTION 'Tidak bisa menggantikan kelas untuk tanggal yang belum terjadi';
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

  -- A flexi-hours class has no schedule to judge a day or a window against — see
  -- clock_in_classroom_teacher, which skips the same two checks for the same reason.
  IF NOT v_is_flexi_hours THEN
    IF extract(isodow FROM p_session_date) > 5 THEN
      RAISE EXCEPTION 'Kelas hanya berjalan hari Senin sampai Jumat';
    END IF;

    -- Only meaningful for today. On a past date the class has already run, which is the whole
    -- point of being able to pick one.
    IF p_session_date = v_today THEN
      v_scheduled_start := (p_session_date::text || ' ' || v_time_start::text)::timestamp
        AT TIME ZONE 'Asia/Makassar';

      -- Same floor as clocking in. No upper bound inside the day: filing coverage after the class
      -- has finished is normal, because she was busy teaching it.
      IF now() < v_scheduled_start - interval '60 minutes' THEN
        RAISE EXCEPTION 'Belum waktunya menggantikan kelas ini (mulai 1 jam sebelum jadwal kelas dimulai)';
      END IF;
    END IF;
  END IF;

  -- Idempotent for the same substitute (a second tap of the button is harmless), but never a
  -- takeover.
  SELECT s.id, s.substitute_teacher_id INTO v_existing_id, v_existing_substitute
    FROM public.classroom_teachers_substitutions s
    WHERE s.classroom_teacher_id = p_classroom_teacher_id
      AND s.session_date = p_session_date;

  IF v_existing_id IS NOT NULL THEN
    IF v_existing_substitute = v_teacher_id THEN
      RETURN v_existing_id;
    END IF;
    RAISE EXCEPTION 'Kelas ini sudah digantikan guru lain pada tanggal tersebut';
  END IF;

  -- The assigned teacher must genuinely have been absent that day. If she clocked in, she taught
  -- it, and this is not a coverage situation.
  IF EXISTS (
    SELECT 1
    FROM public.classroom_teachers_attendances ta
    WHERE ta.classroom_teacher_id = p_classroom_teacher_id
      AND ta.session_date = p_session_date
      AND ta.clocked_in_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Guru kelas ini sudah absen masuk pada tanggal tersebut';
  END IF;

  -- She cannot have been in two rooms at once: refuse a class whose schedule overlaps one she held
  -- on that date, as her own group or as another coverage. Flexi-hours classes have no meaningful
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
                AND s2.session_date = p_session_date
                AND s2.substitute_teacher_id = v_teacher_id
            )
          )
      )
  ) THEN
    RAISE EXCEPTION 'Jadwal kelas ini bentrok dengan kelas Anda yang lain pada tanggal tersebut';
  END IF;

  INSERT INTO public.classroom_teachers_substitutions (
    classroom_teacher_id, substitute_teacher_id, session_date,
    counts_for_pay, created_by_role, reason, created_by
  )
  VALUES (
    p_classroom_teacher_id, v_teacher_id, p_session_date,
    public.default_counts_for_pay(p_classroom_teacher_id, v_teacher_id),
    'teacher', NULLIF(btrim(p_reason), ''), auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.declare_substitution(uuid, date, text) IS
  'A teacher declares that she covered another teacher''s group on a date. Any date up to and '
  'including today — a future date is refused outright, because student attendance draws down a '
  'paid quota and a class nobody has taught cannot be billed. Also refuses unless she is an active '
  'teacher, the class is active, it is not her own group, the date is a weekday, nobody else '
  'already covers it, the assigned teacher did not clock in that day, and it does not clash with '
  'another class she held then. The clock-in window is applied only when the date is today. '
  'Idempotent for the same substitute.';

GRANT EXECUTE ON FUNCTION public.declare_substitution(uuid, date, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Withdrawing a mistake
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.withdraw_substitution(
  p_classroom_teacher_id uuid,
  p_session_date date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_teacher_id uuid;
  v_is_admin boolean := (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin';
BEGIN
  SELECT t.id INTO v_teacher_id FROM public.teachers t WHERE t.auth_user_id = auth.uid();

  IF NOT v_is_admin AND v_teacher_id IS NULL THEN
    RAISE EXCEPTION 'Tidak diizinkan';
  END IF;

  -- Anything already written stays: withdrawing gives up access, it does not undo the work. A
  -- submitted report is the line — once a parent can see it, the author must not be able to walk
  -- away from it.
  IF EXISTS (
    SELECT 1
    FROM public.children_daily_reports r
    WHERE r.classroom_teacher_id = p_classroom_teacher_id
      AND r.report_date = p_session_date
      AND r.submitted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Laporan sudah dikirim untuk kelas ini pada tanggal tersebut, jadi penggantian tidak bisa dibatalkan';
  END IF;

  -- A teacher may undo only her own coverage; an admin any. Without this she would have no way back
  -- from picking the wrong class, and there is no admin screen for substitutions yet.
  DELETE FROM public.classroom_teachers_substitutions s
  WHERE s.classroom_teacher_id = p_classroom_teacher_id
    AND s.session_date = p_session_date
    AND (v_is_admin OR s.substitute_teacher_id = v_teacher_id);
END;
$$;

COMMENT ON FUNCTION public.withdraw_substitution(uuid, date) IS
  'Gives up coverage of a group on one date — the way back from picking the wrong class. A teacher '
  'can only withdraw her own; an admin can withdraw any. Refused once a report for that date has '
  'been submitted, because a parent can already see it. Whatever was written stays; only the access '
  'goes.';

GRANT EXECUTE ON FUNCTION public.withdraw_substitution(uuid, date) TO authenticated, service_role;
