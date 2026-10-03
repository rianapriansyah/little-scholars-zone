-- The hourly rate a teacher is paid moves from the teacher to the class they teach (owner
-- request, 2026-10-03): whoever teaches a class is paid that class's rate, and a teacher no
-- longer carries one of their own.
--
-- This changes the shape of the estimate, not just where the number lives. It was
-- (every minute the teacher logged ÷ 60) × their one rate. It becomes a sum over classes, each
-- with its own rate — a teacher working three classes at two different rates has no single
-- "jam x rate" line any more, so the monthly PDF gains a per-class breakdown instead.
--
-- Every class starts with NO rate, deliberately. The rates in use today cannot be mapped onto
-- classes: both Bimba classes are taught by people on 8.000 AND on 10.000 (Rahma Aulia at 10.000
-- alongside four teachers at 8.000), so any backfill would silently change someone's pay. The
-- owner chose to leave all of them empty and set each one on the Kelas screen. Until a class has
-- a rate its minutes are still logged and shown — they just earn nothing and are reported as
-- missing, rather than quietly counted at zero.
--
-- teacher_rate, not rate: classrooms.price already exists and is what the FAMILY pays. These are
-- two different sides of the same class and must not be confused.

ALTER TABLE public.classrooms ADD COLUMN teacher_rate numeric;

COMMENT ON COLUMN public.classrooms.teacher_rate IS
  'What a teacher earns per hour for teaching this class, in IDR. NULL means not set yet: the '
  'class''s logged minutes earn nothing and the monthly estimate names it as missing a rate, '
  'rather than counting it as zero. Distinct from classrooms.price, which is what the family is '
  'charged. Applies to internal programs too (Piket Pagi, Pembuatan Konten) — they are not billed '
  'to families but are paid work, so they carry a rate like any other class.';

-- Superseded rather than dropped: these are the only record of what each teacher was paid before
-- the switch, and the admin needs them to decide what each class's rate should be. Nothing reads
-- the column any more and the Edit Guru form no longer offers it. Drop it once every class has a
-- rate set — see classrooms.capacity for what happens to a column left behind without a note.
COMMENT ON COLUMN public.teachers.rate IS
  'SUPERSEDED by classrooms.teacher_rate as of 20261003010000 and no longer read by the app. '
  'Kept only as a record of what each teacher was paid before the rate moved to the class, so '
  'the per-class rates can be set from it. Safe to drop once that is done.';
