-- learning_period_status carries the child's name and the class label as plain columns.
--
-- Every app read of the view embedded them through PostgREST (`children(full_name),
-- classrooms(label)`), typed by hand and cast with `as unknown as`. As view columns they are in
-- the generated types, come back flat (child_name / classroom_label), and can be sorted or
-- searched server-side with an ordinary filter.
--
-- LEFT JOINs, not inner: the view is security_invoker, so each join is checked against the
-- caller's RLS. A parent only sees classrooms in family_active_classroom_ids; an inner join would
-- drop their child's periods in a class the child has left. With LEFT JOIN such a row keeps its
-- period and quota, with a null label — exactly what the embed returned.
--
-- GROUP BY gains c.id and cl.id (primary keys) so c.full_name and cl.label may be selected.
-- New columns go last: CREATE OR REPLACE VIEW can only append. Nothing in the database depends on
-- this view (checked: no function or view references it).

CREATE OR REPLACE VIEW public.learning_period_status
WITH (security_invoker = true) AS
SELECT
  lp.id,
  lp.child_id,
  lp.classroom_id,
  lp.period_no,
  lp.start_date,
  lp.projected_end_date,
  lp.actual_end_date,
  lp.guaranteed_days,
  lp.closed_at,
  lp.created_by,
  lp.created_at,
  lp.is_active,
  count(ca.id) FILTER (WHERE ca.status <> 'sick'::text) AS days_consumed,
  count(ca.id) FILTER (WHERE ca.status = 'sick'::text) AS days_sick,
  lp.guaranteed_days - count(ca.id) FILTER (WHERE ca.status <> 'sick'::text) AS days_remaining,
  c.full_name AS child_name,
  cl.label AS classroom_label
FROM public.children_learning_periods lp
LEFT JOIN public.children_attendances ca ON ca.learning_period_id = lp.id
LEFT JOIN public.children c ON c.id = lp.child_id
LEFT JOIN public.classrooms cl ON cl.id = lp.classroom_id
GROUP BY lp.id, c.id, cl.id;
