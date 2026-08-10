-- approve_registration originally took one p_start_date applied to every child in the
-- submission. That's wrong for a family registering siblings into different programs — each
-- child's learning period should start on its own date, set by the admin per child.
--
-- p_start_date date is replaced with p_start_dates jsonb: an object keyed by
-- registration_children.id, each value an ISO date string, e.g.
-- {"<child-row-id>": "2026-08-15", ...}. One entry is required per child in the submission.
--
-- Changing the argument list means this is a new function identity as far as Postgres grants
-- are concerned — CREATE OR REPLACE cannot reuse the old (uuid, text, date) signature's ACL, so
-- the old signature is dropped explicitly and the new one gets the same REVOKE/GRANT treatment
-- as the original (see 20260810010000's comment on why the REVOKE matters: this project grants
-- EXECUTE to anon by default on every new function).

DROP FUNCTION IF EXISTS public.approve_registration(uuid, text, date);

CREATE OR REPLACE FUNCTION public.approve_registration(
  p_submission_id uuid,
  p_login_email text,
  p_start_dates jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_submission public.registration_submissions;
  v_family_id uuid;
  v_child_id uuid;
  v_entry record;
  v_start_date date;
BEGIN
  IF (auth.jwt() -> 'app_metadata' ->> 'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Not authorised to approve registrations';
  END IF;

  IF p_login_email IS NULL OR btrim(p_login_email) = '' THEN
    RAISE EXCEPTION 'A login email is required';
  END IF;

  IF p_start_dates IS NULL OR jsonb_typeof(p_start_dates) <> 'object' THEN
    RAISE EXCEPTION 'A learning period start date is required for every child';
  END IF;

  SELECT * INTO v_submission
    FROM public.registration_submissions
    WHERE id = p_submission_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration submission not found';
  END IF;

  IF v_submission.status <> 'pending' THEN
    RAISE EXCEPTION 'This submission has already been %', v_submission.status;
  END IF;

  INSERT INTO public.families (
    name, contact_email, contact_phone,
    father_name, father_occupation, father_phone,
    mother_name, mother_occupation, mother_phone,
    address, created_by
  )
  VALUES (
    v_submission.family_name, lower(btrim(p_login_email)), v_submission.contact_phone,
    v_submission.father_name, v_submission.father_occupation, v_submission.father_phone,
    v_submission.mother_name, v_submission.mother_occupation, v_submission.mother_phone,
    v_submission.address, auth.uid()
  )
  RETURNING id INTO v_family_id;

  FOR v_entry IN
    SELECT * FROM public.registration_children
    WHERE submission_id = p_submission_id
    ORDER BY created_at
  LOOP
    -- ->> on a uuid key requires the jsonb object's key to be the text form of the id, which is
    -- exactly what the client builds it from (registration_children.id per child).
    v_start_date := (p_start_dates ->> v_entry.id::text)::date;
    IF v_start_date IS NULL THEN
      RAISE EXCEPTION 'Missing learning period start date for %', v_entry.full_name;
    END IF;

    INSERT INTO public.children (family_id, full_name, birth_place, birthdate, notes)
    VALUES (v_family_id, v_entry.full_name, v_entry.birth_place, v_entry.birthdate, v_entry.notes)
    RETURNING id INTO v_child_id;

    UPDATE public.registration_children SET child_id = v_child_id WHERE id = v_entry.id;

    -- period_no 1 unconditionally: this family is brand new, so no child of theirs can already
    -- hold a period in this classroom. guaranteed_days is filled by the existing BEFORE INSERT
    -- trigger from the classroom, so the terms come from the program, not from here.
    INSERT INTO public.learning_periods (child_id, classroom_id, period_no, start_date, created_by)
    VALUES (v_child_id, v_entry.classroom_id, 1, v_start_date, auth.uid());
  END LOOP;

  UPDATE public.registration_submissions
    SET status = 'approved',
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        family_id = v_family_id
    WHERE id = p_submission_id;

  RETURN v_family_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.approve_registration(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_registration(uuid, text, jsonb) TO authenticated, service_role;
