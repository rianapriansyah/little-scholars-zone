-- Tambah Keluarga: a family is only ever added once it has paid for a learning period, so every
-- child entered there arrives with period #1 already sold. Children, their first periods and the
-- paid flag go in as one transaction — the previous client-side children insert could fail
-- halfway and strand a child with no period, which record_attendance() then refuses outright.
--
-- The payment row itself is still created by create_payment_period_for_learning_period (priced
-- from the classroom); this only flips it to paid, with the same semantics as
-- mark_payment_period_paid. Receipts are attached afterwards by the client, since Storage uploads
-- can't happen inside a Postgres transaction — hence the payment_period ids in the result.

CREATE OR REPLACE FUNCTION public.create_children_with_first_periods(
  p_family_id uuid,
  p_children jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry jsonb;
  v_full_name text;
  v_classroom_id uuid;
  v_start_date date;
  v_child_id uuid;
  v_period_id uuid;
  v_payment_id uuid;
  v_result jsonb := '[]'::jsonb;
BEGIN
  IF (auth.jwt() -> 'app_metadata' ->> 'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Not authorised to add children';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.families WHERE id = p_family_id) THEN
    RAISE EXCEPTION 'Keluarga tidak ditemukan';
  END IF;

  IF p_children IS NULL OR jsonb_typeof(p_children) <> 'array' THEN
    RAISE EXCEPTION 'Data anak tidak valid';
  END IF;

  -- WITH ORDINALITY so the result lines up index-for-index with the client's input.
  FOR v_entry IN
    SELECT t.entry FROM jsonb_array_elements(p_children) WITH ORDINALITY AS t(entry, n) ORDER BY t.n
  LOOP
    v_full_name := nullif(btrim(v_entry ->> 'full_name'), '');
    IF v_full_name IS NULL THEN
      RAISE EXCEPTION 'Nama anak wajib diisi';
    END IF;

    v_classroom_id := nullif(v_entry ->> 'classroom_id', '')::uuid;
    IF v_classroom_id IS NULL THEN
      RAISE EXCEPTION 'Pilih kelas untuk %', v_full_name;
    END IF;

    v_start_date := nullif(v_entry ->> 'start_date', '')::date;
    IF v_start_date IS NULL THEN
      RAISE EXCEPTION 'Isi tanggal mulai periode untuk %', v_full_name;
    END IF;

    -- Same rule as fetchActiveClassrooms: only real, fee-paying, active programs can be sold.
    IF NOT EXISTS (
      SELECT 1 FROM public.classrooms WHERE id = v_classroom_id AND active AND is_billable
    ) THEN
      RAISE EXCEPTION 'Kelas untuk % tidak aktif atau tidak ditemukan', v_full_name;
    END IF;

    INSERT INTO public.children (family_id, full_name, birth_place, birthdate, notes)
    VALUES (
      p_family_id,
      v_full_name,
      nullif(btrim(v_entry ->> 'birth_place'), ''),
      nullif(v_entry ->> 'birthdate', '')::date,
      nullif(btrim(v_entry ->> 'notes'), '')
    )
    RETURNING id INTO v_child_id;

    -- A brand-new child has no earlier period in any classroom, so this is always #1.
    INSERT INTO public.learning_periods (child_id, classroom_id, period_no, start_date, created_by)
    VALUES (v_child_id, v_classroom_id, 1, v_start_date, auth.uid())
    RETURNING id INTO v_period_id;

    SELECT id INTO v_payment_id FROM public.payment_periods WHERE learning_period_id = v_period_id;

    IF COALESCE((v_entry ->> 'paid')::boolean, false) THEN
      UPDATE public.payment_periods
        SET status = 'paid',
            paid_at = now()
        WHERE id = v_payment_id;
    END IF;

    v_result := v_result || jsonb_build_array(
      jsonb_build_object('child_id', v_child_id, 'payment_period_id', v_payment_id)
    );
  END LOOP;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_children_with_first_periods(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_children_with_first_periods(uuid, jsonb) TO authenticated, service_role;
