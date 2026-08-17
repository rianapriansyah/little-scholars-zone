-- The previous migration seeded a fresh "Piket Kebersihan Kelas" row without checking for an
-- existing one first. There already was one: "Piket Pagi" (07:00-08:00, price 0, created the
-- same day as this migration) — evidently the admin's own manual first attempt at exactly this
-- feature, before asking for it to be built properly. It has zero classroom_teachers
-- assignments, zero attendance rows, and zero enrolled children, so nothing depends on it yet.
--
-- Keep that row (it's the one already sitting in the admin's classroom list) and drop the
-- duplicate this migration set created instead of leaving two. Piket Pagi also needs
-- is_billable = false — it defaulted to true, which means a Rp 0 "class" has been visible in
-- the parent registration wizard's program list since the moment it was created.

DELETE FROM public.classrooms WHERE label = 'Piket Kebersihan Kelas' AND is_billable = false;

UPDATE public.classrooms
SET is_billable = false
WHERE label = 'Piket Pagi';
