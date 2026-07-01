-- Atomic enrollment operations so classroom capacity + "one active classroom per child"
-- (see children_classrooms_one_active_idx) are never violated by a partial client-side write.

CREATE OR REPLACE FUNCTION public.enroll_child_in_classroom(p_child_id uuid, p_classroom_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_capacity int;
  v_count int;
BEGIN
  SELECT capacity INTO v_capacity FROM public.classrooms WHERE id = p_classroom_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Classroom not found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.children_classrooms WHERE child_id = p_child_id AND ended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Child already has an active classroom enrollment; use switch_classroom instead';
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM public.children_classrooms
    WHERE classroom_id = p_classroom_id AND ended_at IS NULL;

  IF v_count >= v_capacity THEN
    RAISE EXCEPTION 'Classroom is at capacity (% / %)', v_count, v_capacity;
  END IF;

  INSERT INTO public.children_classrooms (child_id, classroom_id, started_at, created_by)
  VALUES (p_child_id, p_classroom_id, current_date, auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.switch_classroom(
  p_child_id uuid,
  p_new_classroom_id uuid,
  p_end_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_capacity int;
  v_count int;
BEGIN
  SELECT capacity INTO v_capacity FROM public.classrooms WHERE id = p_new_classroom_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Classroom not found';
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM public.children_classrooms
    WHERE classroom_id = p_new_classroom_id AND ended_at IS NULL;

  IF v_count >= v_capacity THEN
    RAISE EXCEPTION 'Classroom is at capacity (% / %)', v_count, v_capacity;
  END IF;

  UPDATE public.children_classrooms
    SET ended_at = current_date, end_reason = p_end_reason
    WHERE child_id = p_child_id AND ended_at IS NULL;

  INSERT INTO public.children_classrooms (child_id, classroom_id, started_at, created_by)
  VALUES (p_child_id, p_new_classroom_id, current_date, auth.uid());
END;
$$;

GRANT EXECUTE ON FUNCTION public.enroll_child_in_classroom(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.switch_classroom(uuid, uuid, text) TO authenticated, service_role;
