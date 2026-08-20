-- Correspondence with families happens exclusively via WhatsApp (contact_phone), never email.
-- The email address on a family only exists to serve as their portal login credential, so
-- rename contact_email -> login_email to reflect that.

ALTER TABLE public.families RENAME COLUMN contact_email TO login_email;
ALTER TABLE public.families RENAME CONSTRAINT families_contact_email_key TO families_login_email_key;

CREATE OR REPLACE FUNCTION public.approve_registration(p_submission_id uuid, p_login_email text, p_start_dates jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    name, login_email, contact_phone,
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
$function$
