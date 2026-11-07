-- Step 1 of 2 towards a daily report identified by its absensi row alone (step 2:
-- 20261108050000_daily_report_keyed_by_attendance.sql, which drops report_date and
-- classroom_teacher_id).
--
-- This step only ADDS: two helpers that read a report's group and date through its absensi row, and
-- two read RPCs that the client switches to instead of filtering the table by those columns. Nothing
-- existing changes, so it is safe to apply while the current client is still deployed; the new
-- client works against it too. Step 2 must wait until the new client is live.
--
-- The group rule: the teaching group a report belongs to is the child's placement in the absensi
-- row's class on its date. On a handover day, when switch_classroom leaves the child in two groups
-- for one day, the newer placement wins — which is exactly who wrote every one of the 12
-- handover-day reports on file. Checked before this was written: the derived group equals the
-- stored classroom_teacher_id for all 1,291 linked reports.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER so the answer does not depend on what the caller may read of
-- children_classrooms: RLS policies and RPCs both rely on it.
CREATE FUNCTION public.daily_report_group_id(p_child_attendance_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cc.classroom_teacher_id
    FROM public.child_attendances a
    JOIN public.children_classrooms cc ON cc.child_id = a.child_id
    JOIN public.classroom_teachers ct
      ON ct.id = cc.classroom_teacher_id AND ct.classroom_id = a.classroom_id
   WHERE a.id = p_child_attendance_id
     AND cc.started_at <= a.attendance_date
     AND (cc.ended_at IS NULL OR cc.ended_at >= a.attendance_date)
   ORDER BY cc.started_at DESC, cc.created_at DESC
   LIMIT 1;
$$;

COMMENT ON FUNCTION public.daily_report_group_id(uuid) IS
  'The teaching group a daily report belongs to: the child''s placement in the absensi row''s class on '
  'its date, the newer one on a handover day. The single definition of "whose report is this" once '
  'children_daily_reports.classroom_teacher_id is dropped (20261108050000).';

CREATE FUNCTION public.daily_report_attendance_date(p_child_attendance_id uuid)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT attendance_date FROM public.child_attendances WHERE id = p_child_attendance_id;
$$;

COMMENT ON FUNCTION public.daily_report_attendance_date(uuid) IS
  'The date a daily report is about: its absensi row''s attendance_date. SECURITY DEFINER so a '
  'substitute''s RLS check does not depend on her being able to read child_attendances.';

-- Called by RLS policies as the querying user (from step 2), so authenticated needs EXECUTE; anon
-- never does.
REVOKE EXECUTE ON FUNCTION public.daily_report_group_id(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.daily_report_attendance_date(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.daily_report_group_id(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.daily_report_attendance_date(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Read RPCs. Readable by whoever may write that group's reports that day — its teacher, that day's
-- substitute, an admin — the same people the table's teacher/substitute SELECT policies let through.
-- ---------------------------------------------------------------------------

-- The teacher's roster badges: every report of one group on one date.
CREATE FUNCTION public.daily_report_summaries(p_classroom_teacher_id uuid, p_report_date date)
RETURNS TABLE (id uuid, child_id uuid, submitted_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, r.child_id, r.submitted_at
    FROM public.classroom_teachers ct
    JOIN public.child_attendances a
      ON a.classroom_id = ct.classroom_id AND a.attendance_date = p_report_date
    JOIN public.children_daily_reports r ON r.child_attendance_id = a.id
   WHERE ct.id = p_classroom_teacher_id
     AND public.daily_report_group_id(a.id) = p_classroom_teacher_id
     AND public.can_write_daily_report(p_classroom_teacher_id, p_report_date);
$$;

-- One child's sheet in one group on one date.
CREATE FUNCTION public.daily_report_for_slot(
  p_child_id uuid,
  p_classroom_teacher_id uuid,
  p_report_date date
)
RETURNS TABLE (
  id uuid,
  submitted_at timestamptz,
  mood_arrival text,
  mood_studying text,
  mood_departure text,
  teacher_note text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, r.submitted_at, r.mood_arrival, r.mood_studying, r.mood_departure, r.teacher_note
    FROM public.classroom_teachers ct
    JOIN public.child_attendances a
      ON a.classroom_id = ct.classroom_id
     AND a.child_id = p_child_id
     AND a.attendance_date = p_report_date
    JOIN public.children_daily_reports r ON r.child_attendance_id = a.id
   WHERE ct.id = p_classroom_teacher_id
     AND public.daily_report_group_id(a.id) = p_classroom_teacher_id
     AND public.can_write_daily_report(p_classroom_teacher_id, p_report_date);
$$;

COMMENT ON FUNCTION public.daily_report_summaries(uuid, date) IS
  'Every daily report of one teaching group on one date (id, child, submitted_at), for the roster. '
  'Only for the group''s teacher, that day''s substitute, or an admin.';
COMMENT ON FUNCTION public.daily_report_for_slot(uuid, uuid, date) IS
  'One child''s daily report in one teaching group on one date, for the report sheet. Only for the '
  'group''s teacher, that day''s substitute, or an admin.';

REVOKE EXECUTE ON FUNCTION public.daily_report_summaries(uuid, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.daily_report_for_slot(uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.daily_report_summaries(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.daily_report_for_slot(uuid, uuid, date) TO authenticated, service_role;
