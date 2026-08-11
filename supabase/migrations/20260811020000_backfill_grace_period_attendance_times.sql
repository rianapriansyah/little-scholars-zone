-- One-time backfill: normalizes already-recorded teacher self-clock timestamps that fall
-- within the 5-minute grace window but predate the clock-in/out normalization fix
-- (20260810050000, 20260811010000). Their displayed status already reads 'on_time'
-- (arrival_status/departure_status is computed live by the view), but the stored value itself
-- was never snapped to the exact scheduled instant — this makes the two agree.
--
-- Scope, deliberately narrow:
--   * clocked_in_source / clocked_out_source = 'teacher' only. Admin-entered corrections are
--     never touched — those are a deliberate manual attestation, not a self-clock tap.
--   * Only rows where the stored value is still within the grace window and not already exact.
--     Anything genuinely late/early is untouched, by construction of the same condition the
--     RPCs themselves use.
--
-- Idempotent: once a row is snapped to its scheduled instant, `<> scheduled_start` (or _end) is
-- false and it is never touched again, so running this again after the fact is a no-op.
--
-- Applied against the linked project: 24 clock-in rows and 23 clock-out rows corrected
-- (2026-08-09 through 2026-08-11 attendance).

UPDATE public.classroom_teachers_attendances ta
SET clocked_in_at = sub.scheduled_start
FROM (
  SELECT ta2.id,
    (ta2.session_date::text || ' ' || c.time_start::text)::timestamp AT TIME ZONE 'Asia/Makassar' AS scheduled_start
  FROM public.classroom_teachers_attendances ta2
  JOIN public.classroom_teachers ct ON ct.id = ta2.classroom_teacher_id
  JOIN public.classrooms c ON c.id = ct.classroom_id
  WHERE ta2.clocked_in_source = 'teacher'
) sub
WHERE ta.id = sub.id
  AND ta.clocked_in_at <> sub.scheduled_start
  AND ta.clocked_in_at BETWEEN sub.scheduled_start - interval '5 minutes' AND sub.scheduled_start + interval '5 minutes';

UPDATE public.classroom_teachers_attendances ta
SET clocked_out_at = sub.scheduled_end
FROM (
  SELECT ta2.id,
    (ta2.session_date::text || ' ' || c.time_end::text)::timestamp AT TIME ZONE 'Asia/Makassar' AS scheduled_end
  FROM public.classroom_teachers_attendances ta2
  JOIN public.classroom_teachers ct ON ct.id = ta2.classroom_teacher_id
  JOIN public.classrooms c ON c.id = ct.classroom_id
  WHERE ta2.clocked_out_source = 'teacher'
) sub
WHERE ta.id = sub.id
  AND ta.clocked_out_at IS NOT NULL
  AND ta.clocked_out_at <> sub.scheduled_end
  AND ta.clocked_out_at BETWEEN sub.scheduled_end - interval '5 minutes' AND sub.scheduled_end + interval '5 minutes';
