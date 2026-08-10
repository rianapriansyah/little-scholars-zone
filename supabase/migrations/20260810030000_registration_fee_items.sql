-- Mandatory per-child equipment fees: uniform + stationery kit, charged on every registration
-- alongside the chosen program. Fixed and — per the owner — not expected to change
-- dynamically, but living in a table rather than hardcoded so a future price change or added
-- kit line doesn't need a code deploy.

CREATE TABLE public.registration_fee_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  price numeric(12, 2) NOT NULL CHECK (price >= 0),
  -- One bullet per line, shown under the label exactly as stored, in this order.
  items text[] NOT NULL DEFAULT '{}',
  sort_order smallint NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.registration_fee_items IS
  'Mandatory per-child equipment fees (uniform, stationery) charged alongside the chosen '
  'program on every registration. Read by the public wizard via '
  'list_registration_fee_items() and snapshotted onto each registration_children row at '
  'submission time — same reasoning as registration_children.price: a later price change '
  'here must not rewrite what a family already paid for.';

COMMENT ON COLUMN public.registration_fee_items.items IS
  'Display-only bullet lines (e.g. "1 tas", "Pensil warna 24 warna"). Never parsed — the '
  'price column is the only number that matters to billing.';

INSERT INTO public.registration_fee_items (label, price, items, sort_order) VALUES
  ('Seragam', 450000, ARRAY[
    '1 tas',
    '1 kaos polo kuning (Senin–Selasa)',
    '1 kaos polo biru (Rabu–Kamis)',
    '1 kaos putih (Jumat)'
  ], 1),
  ('Alat Tulis', 250000, ARRAY[
    'Buku gambar 4 pcs',
    'Pensil warna 24 warna',
    'Spidol Snowman 12 warna',
    'Crayon 24 warna',
    'Tempat pensil roll',
    '2 map untuk laporan harian & bulanan'
  ], 2);

GRANT ALL ON public.registration_fee_items TO authenticated, service_role;
ALTER TABLE public.registration_fee_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_all_registration_fee_items ON public.registration_fee_items FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Same pattern as list_active_programs(): the wizard has to show what's mandatory before
-- anyone has logged in. Explicit GRANT to anon (this project's default privileges already
-- hand anon EXECUTE on every new function, but stating it is the honest version of that,
-- matching list_active_programs rather than leaving it implicit).
CREATE OR REPLACE FUNCTION public.list_registration_fee_items()
RETURNS TABLE (
  id uuid,
  label text,
  price numeric,
  items text[],
  sort_order smallint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT f.id, f.label, f.price, f.items, f.sort_order
  FROM public.registration_fee_items f
  WHERE f.active
  ORDER BY f.sort_order;
$$;

GRANT EXECUTE ON FUNCTION public.list_registration_fee_items() TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- registration_children: snapshot the equipment fee total the same way price snapshots the
-- program's price — frozen at submission, never a live lookup back to registration_fee_items.
-- ---------------------------------------------------------------------------

ALTER TABLE public.registration_children ADD COLUMN equipment_fee numeric(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE public.registration_children ALTER COLUMN equipment_fee DROP DEFAULT;
ALTER TABLE public.registration_children
  ADD CONSTRAINT registration_children_equipment_fee_non_negative CHECK (equipment_fee >= 0);

COMMENT ON COLUMN public.registration_children.equipment_fee IS
  'Snapshot of the sum of registration_fee_items.price (all active rows) at submission time '
  'for this child — the mandatory uniform + stationery total. Set by the submit-registration '
  'Edge Function, never by the client. registration_submissions.amount_total already includes '
  'this per child; it is broken out here only so the admin review screen can show it.';
