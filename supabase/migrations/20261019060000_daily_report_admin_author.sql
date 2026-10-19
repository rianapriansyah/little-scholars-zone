-- An admin can now fill a day's absensi and Catatan Guru from Detail Periode Belajar (the Tambah
-- Absen button on Riwayat Absensi), for the days nobody got to at the time. "Diisi oleh" has to say
-- so.
--
-- Until now the author chain was submitted_by -> created_by -> the group's assigned teacher, and
-- every step resolved through public.teachers. An admin has no teachers row, so an admin-written
-- report fell all the way through to the assigned teacher — printing the name of someone who did
-- not write it, which is exactly the dishonesty the submitted_by chain was added to remove.
--
-- So the chain gains an admin step after each of submitted_by and created_by: if that auth user is
-- not a teacher but does carry app_metadata.role = 'admin', the report was filled from the admin
-- side. Reading auth.users is fine here — the function is already SECURITY DEFINER for the same
-- reason it reads teachers.
--
-- Signalled as a separate boolean rather than by returning the word "Admin" as a name: the two name
-- columns come back raw precisely so teacherDisplayName() in the client stays the single place the
-- call-name-over-full-name rule lives, and a label is the client's business too. The client prints
-- "Admin"; this only says which case it is.

DROP FUNCTION IF EXISTS public.daily_report_for_attendance(uuid, uuid, date);

CREATE OR REPLACE FUNCTION public.daily_report_for_attendance(
  p_child_id uuid,
  p_classroom_id uuid,
  p_report_date date
)
RETURNS TABLE (
  id uuid,
  submitted_at timestamptz,
  mood_arrival text,
  mood_studying text,
  mood_departure text,
  teacher_note text,
  teacher_full_name text,
  teacher_call_name text,
  author_is_admin boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    r.id,
    r.submitted_at,
    r.mood_arrival,
    r.mood_studying,
    r.mood_departure,
    r.teacher_note,
    author.full_name,
    author.call_name,
    author.is_admin
  FROM public.children_daily_reports r
  JOIN public.classroom_teachers ct ON ct.id = r.classroom_teacher_id
  -- One row, chosen by priority, so the name and the call name can never come from different
  -- people: independent COALESCEs over separate joins would happily pair one teacher's full name
  -- with another's call name whenever the first has none.
  LEFT JOIN LATERAL (
    SELECT candidate.full_name, candidate.call_name, candidate.is_admin
    FROM (
      SELECT 1 AS prio, ts.full_name, ts.call_name, false AS is_admin
        FROM public.teachers ts WHERE ts.auth_user_id = r.submitted_by
      UNION ALL
      SELECT 2, NULL::text, NULL::text, true
        FROM auth.users su
        WHERE su.id = r.submitted_by
          AND (su.raw_app_meta_data ->> 'role') = 'admin'
      UNION ALL
      SELECT 3, tc.full_name, tc.call_name, false
        FROM public.teachers tc WHERE tc.auth_user_id = r.created_by
      UNION ALL
      SELECT 4, NULL::text, NULL::text, true
        FROM auth.users cu
        WHERE cu.id = r.created_by
          AND (cu.raw_app_meta_data ->> 'role') = 'admin'
      UNION ALL
      -- Last resort: whoever the group belongs to. Covers reports written before submitted_by
      -- existed, and a teacher account since deleted.
      SELECT 5, ta.full_name, ta.call_name, false
        FROM public.teachers ta WHERE ta.id = ct.teacher_id
    ) candidate
    ORDER BY candidate.prio
    LIMIT 1
  ) author ON true
  WHERE r.child_id = p_child_id
    AND ct.classroom_id = p_classroom_id
    AND r.report_date = p_report_date
    AND (
      (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
      OR r.classroom_teacher_id IN (SELECT public.teacher_classroom_teacher_ids(auth.uid()))
      -- The substitute reads back the day she covered, and only that day.
      OR public.is_substitute_for(r.classroom_teacher_id, r.report_date)
      OR (
        r.submitted_at IS NOT NULL
        AND r.child_id IN (SELECT public.family_children_ids(auth.uid()))
      )
    )
  -- At most one row in practice (one report per child per group per day). Ordered and capped
  -- anyway so a child moved between two groups of the same classroom mid-day cannot make the
  -- caller choose arbitrarily — the sent one wins over a draft.
  ORDER BY r.submitted_at DESC NULLS LAST, r.id
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.daily_report_for_attendance(uuid, uuid, date) IS
  'The daily report belonging to one attendance day (child + classroom + date), joined through '
  'classroom_teachers. SECURITY DEFINER with its own access clause mirroring '
  'children_daily_reports'' RLS: admin sees all, a teacher their own groups, a substitute the day '
  'she covered, a parent their own children and only once submitted. Exists because a parent '
  'cannot read either side of that join — classroom_teachers only while the enrolment is current, '
  'teachers not at all. The author is whoever actually filled it: submitted_by, then created_by, '
  'then the group''s assigned teacher, with author_is_admin set when that person is an admin '
  'rather than a teacher (the two name columns are then NULL, and the client labels it).';

GRANT EXECUTE ON FUNCTION public.daily_report_for_attendance(uuid, uuid, date) TO authenticated, service_role;
