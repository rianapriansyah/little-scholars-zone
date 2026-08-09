-- Parent self-registration: a public wizard fills this in, an admin verifies the payment
-- receipt and approves.
--
-- A submission is deliberately NOT a family. It is a staging record holding a copy of the
-- form data until an admin approves it, so an anonymous visitor can never write into
-- families / children / learning_periods — those tables keep their admin-only policies
-- unchanged. Approval is the one place a submission turns into real records, and it happens
-- inside approve_registration() so it is all-or-nothing.
--
-- Nothing here is reachable by the anon role except public.list_active_programs(). Public
-- writes arrive through the `submit-registration` Edge Function under the service role.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE public.registration_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Given to the parent on the success screen. There is no parent-facing status page and no
  -- email correspondence anywhere in this app, so this code exists purely so a parent can
  -- quote it when they phone or WhatsApp the center.
  reference_code text NOT NULL UNIQUE,

  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),

  family_name text NOT NULL,
  -- The only contact channel. No email column on purpose: the sole email in this flow is the
  -- generated ...@lsz.id login, and that is created at approval, never typed by anyone.
  contact_phone text NOT NULL,

  father_name text,
  father_occupation text,
  father_phone text,
  mother_name text,
  mother_occupation text,
  mother_phone text,
  address text,

  -- Object path in the private `registration-receipts` bucket. NOT NULL: a pending submission
  -- with no receipt is not reviewable, so the client uploads first and submits second.
  receipt_path text NOT NULL,
  amount_total numeric(12, 2) NOT NULL CHECK (amount_total >= 0),
  payment_note text,

  submitted_at timestamptz NOT NULL DEFAULT now(),

  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  rejection_reason text,
  family_id uuid REFERENCES public.families(id)
);

COMMENT ON TABLE public.registration_submissions IS
  'Staging record for a parent self-registration. Becomes a families row (plus children and '
  'learning periods) only via approve_registration().';

COMMENT ON COLUMN public.registration_submissions.amount_total IS
  'Sum of registration_children.price, computed server-side in the submit-registration Edge '
  'Function from classrooms.price. Never taken from the client — the receipt is proof of this '
  'number.';

COMMENT ON COLUMN public.registration_submissions.family_id IS
  'The families row this submission created. NULL until approved; the audit trail from a real '
  'family back to the form the parent actually filled in.';

CREATE TABLE public.registration_children (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL
    REFERENCES public.registration_submissions(id) ON DELETE CASCADE,

  full_name text NOT NULL,
  birth_place text,
  birthdate date,
  notes text,

  -- The billable program the parent chose for this child. classroom_id, not
  -- classroom_teacher_id: the parent buys a program, and which teacher's group they sit in is
  -- an admin decision made after approval (see the note on learning_periods.classroom_id).
  classroom_id uuid NOT NULL REFERENCES public.classrooms(id),
  price numeric(12, 2) NOT NULL CHECK (price >= 0),

  child_id uuid REFERENCES public.children(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.registration_children.price IS
  'Snapshot of classrooms.price at submission time. A copy rather than a lookup because the '
  'uploaded receipt is proof of what was quoted that day; repricing the classroom later must '
  'not rewrite what this parent paid.';

COMMENT ON COLUMN public.registration_children.child_id IS
  'The children row this entry created. NULL until approved.';

CREATE INDEX registration_submissions_status_idx
  ON public.registration_submissions (status, submitted_at DESC);

-- Supports the duplicate-submission guard in the Edge Function.
CREATE INDEX registration_submissions_contact_phone_idx
  ON public.registration_submissions (contact_phone);

CREATE INDEX registration_children_submission_id_idx
  ON public.registration_children (submission_id);

-- ---------------------------------------------------------------------------
-- Reference code
-- ---------------------------------------------------------------------------

-- Ambiguous glyphs (0/O, 1/I) are left out: this gets read aloud over the phone.
CREATE OR REPLACE FUNCTION public.generate_registration_reference_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  v_alphabet CONSTANT text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_attempt int := 0;
BEGIN
  LOOP
    v_code := '';
    FOR i IN 1..6 LOOP
      v_code := v_code || substr(v_alphabet, floor(random() * length(v_alphabet))::int + 1, 1);
    END LOOP;

    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.registration_submissions WHERE reference_code = v_code
    );

    v_attempt := v_attempt + 1;
    IF v_attempt > 20 THEN
      RAISE EXCEPTION 'Could not generate a unique registration reference code';
    END IF;
  END LOOP;

  RETURN v_code;
END;
$$;

ALTER TABLE public.registration_submissions
  ALTER COLUMN reference_code SET DEFAULT public.generate_registration_reference_code();

-- ---------------------------------------------------------------------------
-- Grants + RLS — admin only. The anon role is granted nothing on these tables.
-- ---------------------------------------------------------------------------

GRANT ALL ON public.registration_submissions TO authenticated, service_role;
GRANT ALL ON public.registration_children TO authenticated, service_role;

ALTER TABLE public.registration_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registration_children ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_all_registration_submissions ON public.registration_submissions FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY admin_all_registration_children ON public.registration_children FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- ---------------------------------------------------------------------------
-- Receipt storage — private, unlike child-photos / teacher-photos
-- ---------------------------------------------------------------------------

-- public = false: these are payment documents, not avatars. The admin UI reads them through
-- a short-lived signed URL; the Edge Function writes them under the service role.
INSERT INTO storage.buckets (id, name, public)
VALUES ('registration-receipts', 'registration-receipts', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY admin_read_registration_receipts ON storage.objects FOR ALL
  USING (bucket_id = 'registration-receipts' AND (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK (bucket_id = 'registration-receipts' AND (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- ---------------------------------------------------------------------------
-- Public program list
-- ---------------------------------------------------------------------------

-- The wizard has to show what is on offer before anyone has logged in. A SECURITY DEFINER
-- function rather than an anon SELECT policy on classrooms: this exposes exactly the six
-- display columns of active classrooms and nothing else, and adding a column to classrooms
-- later cannot silently widen what the public can read.
CREATE OR REPLACE FUNCTION public.list_active_programs()
RETURNS TABLE (
  id uuid,
  label text,
  time_start time,
  time_end time,
  price numeric,
  guaranteed_days smallint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT c.id, c.label, c.time_start, c.time_end, c.price, c.guaranteed_days
  FROM public.classrooms c
  WHERE c.active
  ORDER BY c.label;
$$;

GRANT EXECUTE ON FUNCTION public.list_active_programs() TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Approval
-- ---------------------------------------------------------------------------

-- Turns a pending submission into real records, in one transaction: one families row, one
-- children row per registration child, and one learning period per child.
--
-- What it deliberately does NOT do:
--   * create the Auth login — that is create-family-account's job, called by the client
--     straight after this returns. It upserts families by contact_email, finds the row this
--     function just wrote, and links auth_user_id onto it.
--   * insert children_classrooms — enrollment keys off classroom_teacher_id (which teacher's
--     group), and the parent chose a classroom, not a group. The admin assigns that afterwards
--     on the existing screen.
--
-- p_start_date has no default on purpose: when a period starts is the center's call, so
-- approval cannot happen without an admin stating it.
CREATE OR REPLACE FUNCTION public.approve_registration(
  p_submission_id uuid,
  p_login_email text,
  p_start_date date
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
BEGIN
  -- IS DISTINCT FROM, not <>: an anon caller's JWT carries no app_metadata claim at all, so
  -- the left side is NULL, and `NULL <> 'admin'` is itself NULL — which PL/pgSQL's IF treats
  -- as false, silently skipping the RAISE and letting the call through. IS DISTINCT FROM
  -- treats NULL as an ordinary comparable value, so this closes that hole. (Confirmed live
  -- against this project: functions get EXECUTE granted to anon directly by default, not just
  -- via PUBLIC — see the explicit REVOKE below, which is the enforcement that actually
  -- matters; this check is defense in depth on top of it.)
  IF (auth.jwt() -> 'app_metadata' ->> 'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Not authorised to approve registrations';
  END IF;

  IF p_login_email IS NULL OR btrim(p_login_email) = '' THEN
    RAISE EXCEPTION 'A login email is required';
  END IF;

  IF p_start_date IS NULL THEN
    RAISE EXCEPTION 'A learning period start date is required';
  END IF;

  -- FOR UPDATE so two admins clicking Setujui at the same time cannot both get past the
  -- status check below.
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
    INSERT INTO public.children (family_id, full_name, birth_place, birthdate, notes)
    VALUES (v_family_id, v_entry.full_name, v_entry.birth_place, v_entry.birthdate, v_entry.notes)
    RETURNING id INTO v_child_id;

    UPDATE public.registration_children SET child_id = v_child_id WHERE id = v_entry.id;

    -- period_no 1 unconditionally: this family is brand new, so no child of theirs can already
    -- hold a period in this classroom. guaranteed_days is filled by the existing BEFORE INSERT
    -- trigger from the classroom, so the terms come from the program, not from here.
    INSERT INTO public.learning_periods (child_id, classroom_id, period_no, start_date, created_by)
    VALUES (v_child_id, v_entry.classroom_id, 1, p_start_date, auth.uid());
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

-- Explicit REVOKE, not just an omitted GRANT: this project's default privileges hand EXECUTE
-- on every new public-schema function to anon directly (not only via PUBLIC), so leaving this
-- out would silently re-open the hole the IS DISTINCT FROM fix above closes in the body.
REVOKE EXECUTE ON FUNCTION public.approve_registration(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_registration(uuid, text, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reject_registration(
  p_submission_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF (auth.jwt() -> 'app_metadata' ->> 'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Not authorised to reject registrations';
  END IF;

  SELECT status INTO v_status
    FROM public.registration_submissions
    WHERE id = p_submission_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration submission not found';
  END IF;

  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'This submission has already been %', v_status;
  END IF;

  UPDATE public.registration_submissions
    SET status = 'rejected',
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        rejection_reason = nullif(btrim(p_reason), '')
    WHERE id = p_submission_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reject_registration(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_registration(uuid, text) TO authenticated, service_role;
