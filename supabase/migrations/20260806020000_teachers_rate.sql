-- Hourly rate for payroll estimation. Nullable and no default: an unset rate means "not
-- configured yet" rather than silently implying a free rate, which numeric(12,2) NOT NULL
-- DEFAULT 0 would do. Payroll math itself still stays manual — this is read only by the
-- Kehadiran Guru monthly PDF, to print an *estimate*, never to actually pay anyone.
ALTER TABLE public.teachers ADD COLUMN rate numeric(12, 2);
ALTER TABLE public.teachers ADD CONSTRAINT teachers_rate_non_negative CHECK (rate IS NULL OR rate >= 0);

COMMENT ON COLUMN public.teachers.rate IS
  'Hourly rate in IDR, used only to estimate pay on the Kehadiran Guru monthly PDF. NULL means '
  'not set yet. Never used for anything else — payroll stays a manual process.';
