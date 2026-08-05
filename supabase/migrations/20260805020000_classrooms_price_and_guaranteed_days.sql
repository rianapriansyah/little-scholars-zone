-- A classroom IS the billable program, so the commercial terms belong on it: what it costs
-- and how many guaranteed attendance days it buys.
--
-- Payment records themselves stay out of scope. This is the price list, not a ledger.

-- DEFAULT 0 exists only to satisfy NOT NULL for the 10 existing rows, then is dropped so a
-- new classroom must state its price rather than silently inheriting a free one. Existing
-- rows land on 0 and need real prices filled in by hand.
ALTER TABLE public.classrooms ADD COLUMN price numeric(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE public.classrooms ALTER COLUMN price DROP DEFAULT;
ALTER TABLE public.classrooms ADD CONSTRAINT classrooms_price_non_negative CHECK (price >= 0);

-- 20 is the standing business default, so unlike price it is a sensible thing to inherit.
ALTER TABLE public.classrooms ADD COLUMN guaranteed_days smallint NOT NULL DEFAULT 20;
ALTER TABLE public.classrooms
  ADD CONSTRAINT classrooms_guaranteed_days_positive CHECK (guaranteed_days > 0);

COMMENT ON COLUMN public.classrooms.price IS
  'What one learning period of this program costs, in IDR. No default on purpose — a new '
  'classroom must state its price. Not yet read by any payment logic.';

COMMENT ON COLUMN public.classrooms.guaranteed_days IS
  'Attendance days one learning period of this program buys. Copied onto each new '
  'learning_periods row at insert; changing it here never alters periods already sold.';

-- ---------------------------------------------------------------------------
-- learning_periods.guaranteed_days is derived from the classroom — at insert only
-- ---------------------------------------------------------------------------

-- Deliberately a copy rather than a lookup through classroom_id. A period is a contract sold
-- on certain terms: if the owner later moves a classroom from 20 days to 24, periods already
-- running must keep the 20 days the parent actually paid for. Reading through live would
-- silently rewrite history, and learning_period_status would start reporting a quota nobody
-- agreed to.
CREATE OR REPLACE FUNCTION public.learning_periods_derive_guaranteed_days()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guaranteed_days smallint;
BEGIN
  SELECT c.guaranteed_days INTO v_guaranteed_days
    FROM public.classrooms c
    WHERE c.id = NEW.classroom_id;

  IF v_guaranteed_days IS NULL THEN
    RAISE EXCEPTION 'Classroom % not found', NEW.classroom_id;
  END IF;

  NEW.guaranteed_days := v_guaranteed_days;
  RETURN NEW;
END;
$$;

-- BEFORE INSERT only: an UPDATE is left alone so a bespoke deal can still be adjusted
-- deliberately after the fact.
DROP TRIGGER IF EXISTS trg_learning_periods_guaranteed_days ON public.learning_periods;
CREATE TRIGGER trg_learning_periods_guaranteed_days
  BEFORE INSERT ON public.learning_periods
  FOR EACH ROW
  EXECUTE FUNCTION public.learning_periods_derive_guaranteed_days();

COMMENT ON COLUMN public.learning_periods.guaranteed_days IS
  'Days the parent paid for. Copied from classrooms.guaranteed_days by '
  'trg_learning_periods_guaranteed_days at insert, then frozen — it is the term this period '
  'was sold on, not a live reflection of the classroom.';
