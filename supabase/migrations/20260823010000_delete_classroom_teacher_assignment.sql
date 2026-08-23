-- A plain DELETE on classroom_teachers is blocked by FK RESTRICT the moment any attendance or
-- daily report has ever been recorded against it (classroom_teachers_attendances, daily_reports),
-- or any child has ever been enrolled (children_classrooms) — even after that history is over.
-- ClassroomAssignmentTab already surfaces that as a friendly "can't delete" message (23503), but
-- there was no way to actually remove an assignment once it had any history.
--
-- This RPC is the explicit, confirmed-by-the-admin escape hatch: after the client shows a
-- confirmation ("this will remove all recorded attendance") and the admin proceeds, it deletes
-- the assignment's attendance and report history along with it, in one transaction. It still
-- refuses to run while the group has an active (non-ended) roster — those students must be moved
-- to another teacher first so their current enrollment doesn't just vanish.
CREATE OR REPLACE FUNCTION public.delete_classroom_teacher_assignment(p_classroom_teacher_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (auth.jwt() -> 'app_metadata' ->> 'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Not authorised to delete classroom assignments';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.children_classrooms
    WHERE classroom_teacher_id = p_classroom_teacher_id AND ended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'This assignment still has active students; move them to another teacher first';
  END IF;

  -- daily_report_items cascades from daily_reports on its own (ON DELETE CASCADE).
  DELETE FROM public.classroom_teachers_attendances WHERE classroom_teacher_id = p_classroom_teacher_id;
  DELETE FROM public.daily_reports WHERE classroom_teacher_id = p_classroom_teacher_id;
  DELETE FROM public.children_classrooms WHERE classroom_teacher_id = p_classroom_teacher_id;

  DELETE FROM public.classroom_teachers WHERE id = p_classroom_teacher_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Classroom/teacher assignment not found';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_classroom_teacher_assignment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_classroom_teacher_assignment(uuid) TO authenticated, service_role;
