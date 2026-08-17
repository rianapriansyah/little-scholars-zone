-- Payment periods: one invoice per learning period.
--
-- Keyed by learning_period_id, NOT by (registration_submission_id, learning_period_id) — a
-- child's very first period (period_no 1) is created from a registration_submission via
-- approve_registration(), but every later period (period_no 2, 3…) is created straight from
-- the admin's "Tambah Periode Belajar" dialog with no submission involved at all. Keying on
-- both would leave renewals structurally unable to get an invoice.
-- registration_submission_id is kept as a nullable traceability column instead: filled in for
-- period_no 1 rows that came from the wizard, NULL for every renewal.
--
-- Created automatically the moment a learning_periods row is inserted (see the trigger below),
-- for both insert paths (approve_registration and the admin dialog), so a period can never
-- exist without a matching invoice record.
--
-- Deliberately does not gate anything: learning_period_status.is_active does not read this
-- table. A period can start, and attendance can be recorded against it, before or during the
-- time its payment is settled — same "payment is out of scope for the quota" boundary the
-- learning_periods migration already draws.

CREATE TABLE public.payment_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  learning_period_id uuid NOT NULL UNIQUE REFERENCES public.learning_periods(id),
  registration_submission_id uuid REFERENCES public.registration_submissions(id),

  -- Denormalized from learning_periods, same reasoning as child_attendances.child_id: keeps
  -- the parent RLS policy a plain `child_id IN (...)` with no join back to learning_periods.
  child_id uuid NOT NULL REFERENCES public.children(id),

  -- Snapshot of classrooms.price at the moment the learning period was created — same "frozen,
  -- never a live lookup" rule as registration_children.price. A later price change on the
  -- classroom must not rewrite what this period was actually invoiced for.
  amount numeric(12, 2) NOT NULL CHECK (amount >= 0),

  status text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid')),
  due_date date,
  paid_at timestamptz,

  -- Admin-uploaded, history only — never gates `status`. The admin marks paid directly; a
  -- receipt can be attached before or after that, purely as a record to look back on.
  receipt_path text,
  payment_note text,

  created_by uuid REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.payment_periods IS
  'One invoice per learning period, auto-created by learning_periods_create_payment_period '
  'the moment the period is inserted. Sending an invoice (PDF download + prefilled WhatsApp '
  'text) is a client-side action with nothing stamped server-side; only the paid/unpaid '
  'transition is tracked here.';

COMMENT ON COLUMN public.payment_periods.registration_submission_id IS
  'Traceability only, not a key. Set for period_no 1 rows created via approve_registration(); '
  'NULL for every renewal period, which never has a submission behind it.';

CREATE INDEX payment_periods_child_id_idx ON public.payment_periods (child_id);
CREATE INDEX payment_periods_unpaid_idx ON public.payment_periods (due_date) WHERE status = 'unpaid';

GRANT ALL ON public.payment_periods TO authenticated, service_role;
ALTER TABLE public.payment_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_all_payment_periods ON public.payment_periods FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Billing stays out of the teacher portal entirely (no teacher policy at all) — a parent can
-- read their own child's invoice status.
CREATE POLICY parent_select_own_payment_periods ON public.payment_periods FOR SELECT
  USING (child_id IN (SELECT public.family_children_ids(auth.uid())));

-- ---------------------------------------------------------------------------
-- Auto-creation: fires for every learning_periods insert, whichever path wrote it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_payment_period_for_learning_period()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount numeric(12, 2);
  v_submission_id uuid;
BEGIN
  SELECT price INTO v_amount FROM public.classrooms WHERE id = NEW.classroom_id;

  -- Only a first period can possibly trace back to a registration submission; matching on
  -- (child_id, classroom_id) is the only link available since registration_children has no
  -- direct pointer to the learning_period it eventually caused.
  IF NEW.period_no = 1 THEN
    SELECT rc.submission_id INTO v_submission_id
      FROM public.registration_children rc
      WHERE rc.child_id = NEW.child_id AND rc.classroom_id = NEW.classroom_id
      ORDER BY rc.created_at
      LIMIT 1;
  END IF;

  INSERT INTO public.payment_periods (learning_period_id, child_id, registration_submission_id, amount, created_by)
  VALUES (NEW.id, NEW.child_id, v_submission_id, COALESCE(v_amount, 0), NEW.created_by);

  RETURN NEW;
END;
$$;

CREATE TRIGGER learning_periods_create_payment_period
  AFTER INSERT ON public.learning_periods
  FOR EACH ROW EXECUTE FUNCTION public.create_payment_period_for_learning_period();

-- Backfill every learning_periods row that predates this migration.
INSERT INTO public.payment_periods (learning_period_id, child_id, registration_submission_id, amount, created_by, created_at)
SELECT
  lp.id,
  lp.child_id,
  CASE WHEN lp.period_no = 1 THEN (
    SELECT rc.submission_id
      FROM public.registration_children rc
      WHERE rc.child_id = lp.child_id AND rc.classroom_id = lp.classroom_id
      ORDER BY rc.created_at
      LIMIT 1
  ) END,
  COALESCE(c.price, 0),
  lp.created_by,
  lp.created_at
FROM public.learning_periods lp
JOIN public.classrooms c ON c.id = lp.classroom_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.payment_periods pp WHERE pp.learning_period_id = lp.id
);

-- ---------------------------------------------------------------------------
-- Mark paid
-- ---------------------------------------------------------------------------

-- Every other column (due_date, payment_note, receipt_path) is editable directly through
-- admin_all_payment_periods — this RPC exists only so the paid/unpaid transition always stamps
-- paid_at consistently rather than relying on client code to set it correctly every time.
CREATE OR REPLACE FUNCTION public.mark_payment_period_paid(
  p_payment_period_id uuid,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (auth.jwt() -> 'app_metadata' ->> 'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Not authorised to mark payments';
  END IF;

  UPDATE public.payment_periods
    SET status = 'paid',
        paid_at = now(),
        payment_note = COALESCE(nullif(btrim(p_note), ''), payment_note)
    WHERE id = p_payment_period_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment period not found';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_payment_period_paid(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_payment_period_paid(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Receipts bucket: consolidated. registration_submissions.receipt_path and
-- payment_periods.receipt_path now share one private bucket instead of registration having its
-- own — both are "proof of a payment", the only difference is which flow uploaded it.
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES ('payment-receipts', 'payment-receipts', false)
ON CONFLICT (id) DO NOTHING;

UPDATE storage.objects SET bucket_id = 'payment-receipts' WHERE bucket_id = 'registration-receipts';

-- Storage protects storage.buckets from a plain DELETE (protect_buckets_delete, "use the
-- Storage API instead") — the old bucket is left registered but now empty and with no policy
-- of its own, so it is inert. Removing the row itself would need the Storage API/dashboard.
DROP POLICY IF EXISTS admin_read_registration_receipts ON storage.objects;

CREATE POLICY admin_all_payment_receipts ON storage.objects FOR ALL
  USING (bucket_id = 'payment-receipts' AND (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK (bucket_id = 'payment-receipts' AND (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- submit-registration writes here under the service role (which bypasses RLS entirely), so it
-- needs no policy of its own — but it does need redeploying with BUCKET renamed to
-- 'payment-receipts' before the wizard can upload again.
