-- How many children one teacher may hold in a class becomes configurable per class (owner
-- request). Until now it was the literal 6 written into enroll_child_in_classroom and
-- switch_classroom, with a matching constant in the client for the "3/6" counters.
--
-- Per class, not per assignment: the limit describes the class — its room, its age group, the
-- ratio it needs — so every teacher assigned to it gets the same number. 12 numbers to manage
-- rather than one per teacher-and-class pair, and the admin sets it where they already set the
-- price and the teacher's rate.
--
-- NOT NULL DEFAULT 6 rather than a nullable column with a fallback, so that:
--   * nothing changes on application — every existing class gets exactly the 6 it had;
--   * there is no COALESCE and no "unset" state for the RPCs or the UI to interpret;
--   * this default is the ONLY 6 left in the system. The client constant
--     (lib/enrollmentLimits.ts) is deleted in the same change, because two copies of a rule the
--     server enforces will eventually disagree — the counter would read "3/6" while the server
--     refused the fourth child.
--
-- Lowering it below a group's current size is allowed and only blocks further enrolments; the
-- children already there stay. Refusing the edit instead would mean an admin cannot shrink a
-- class without first moving children out of it, which is the wrong way round.

ALTER TABLE public.classrooms
  ADD COLUMN max_students_per_teacher smallint NOT NULL DEFAULT 6
  CONSTRAINT classrooms_max_students_per_teacher_positive CHECK (max_students_per_teacher >= 1);

COMMENT ON COLUMN public.classrooms.max_students_per_teacher IS
  'How many children ONE teacher may have actively enrolled in this class. Applies to every '
  'teacher assigned to it, so a class with three teachers holds up to three times this number. '
  'Enforced by enroll_child_in_classroom and switch_classroom; the single source of truth for '
  'the limit, including the "n/max" counters in the admin and teacher screens. Lowering it does '
  'not remove anyone — it only stops further enrolments until the group drops below it.';

-- ---------------------------------------------------------------------------
-- Both enrolment RPCs: read the limit instead of hardcoding it. Everything else is copied
-- unchanged from their live definitions, and the message now names the number that was actually
-- applied, so a refusal explains itself when a class is not on 6.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enroll_child_in_classroom(p_child_id uuid, p_classroom_teacher_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_classroom_id uuid;
  v_max smallint;
  v_count int;
BEGIN
  SELECT ct.classroom_id, c.max_students_per_teacher
    INTO v_classroom_id, v_max
    FROM public.classroom_teachers ct
    JOIN public.classrooms c ON c.id = ct.classroom_id
    WHERE ct.id = p_classroom_teacher_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Classroom/teacher assignment not found';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.children_classrooms cc
    JOIN public.classroom_teachers ct ON ct.id = cc.classroom_teacher_id
    WHERE cc.child_id = p_child_id
      AND cc.ended_at IS NULL
      AND ct.classroom_id = v_classroom_id
  ) THEN
    RAISE EXCEPTION 'Child already has an active enrollment in this classroom; use switch_classroom instead';
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM public.children_classrooms
    WHERE classroom_teacher_id = p_classroom_teacher_id AND ended_at IS NULL;

  IF v_count >= v_max THEN
    RAISE EXCEPTION 'This teacher already has the maximum of % students', v_max;
  END IF;

  INSERT INTO public.children_classrooms (child_id, classroom_teacher_id, started_at, created_by)
  VALUES (p_child_id, p_classroom_teacher_id, current_date, auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.switch_classroom(
  p_child_id uuid,
  p_new_classroom_teacher_id uuid,
  p_end_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_classroom_id uuid;
  v_max smallint;
  v_count int;
BEGIN
  SELECT ct.classroom_id, c.max_students_per_teacher
    INTO v_classroom_id, v_max
    FROM public.classroom_teachers ct
    JOIN public.classrooms c ON c.id = ct.classroom_id
    WHERE ct.id = p_new_classroom_teacher_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Classroom/teacher assignment not found';
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM public.children_classrooms
    WHERE classroom_teacher_id = p_new_classroom_teacher_id AND ended_at IS NULL;

  IF v_count >= v_max THEN
    RAISE EXCEPTION 'This teacher already has the maximum of % students', v_max;
  END IF;

  -- Only the enrollment in the same program is closed; the child keeps their other programs.
  UPDATE public.children_classrooms cc
    SET ended_at = current_date, end_reason = p_end_reason
    FROM public.classroom_teachers ct
    WHERE ct.id = cc.classroom_teacher_id
      AND cc.child_id = p_child_id
      AND cc.ended_at IS NULL
      AND ct.classroom_id = v_classroom_id;

  INSERT INTO public.children_classrooms (child_id, classroom_teacher_id, started_at, created_by)
  VALUES (p_child_id, p_new_classroom_teacher_id, current_date, auth.uid());
END;
$$;

GRANT EXECUTE ON FUNCTION public.enroll_child_in_classroom(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.switch_classroom(uuid, uuid, text) TO authenticated, service_role;
