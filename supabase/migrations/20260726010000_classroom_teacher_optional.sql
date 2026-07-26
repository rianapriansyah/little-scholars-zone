-- Classrooms are now created without a teacher; the teacher (and roster) is assigned
-- afterwards from the admin "Assign teacher & students" screen.
ALTER TABLE public.classrooms ALTER COLUMN teacher_id DROP NOT NULL;

-- Companion to enroll_child_in_classroom/switch_classroom: lets the admin assignment
-- screen remove a child from a classroom without enrolling them anywhere else.
CREATE OR REPLACE FUNCTION public.unenroll_child(p_child_id uuid, p_end_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.children_classrooms
    SET ended_at = current_date, end_reason = p_end_reason
    WHERE child_id = p_child_id AND ended_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Child has no active classroom enrollment';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unenroll_child(uuid, text) TO authenticated, service_role;
