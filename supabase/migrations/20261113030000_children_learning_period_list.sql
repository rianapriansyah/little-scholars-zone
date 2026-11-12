-- The Periode Belajar (Learning Period) list: one row per ACTIVE child, whether or not they have a
-- learning period, with the four grid columns precomputed.
--
-- Until now the screen read learning_period_status — one row per open period (~300 rows, ~160 KB)
-- — and grouped/tallied in the app, so a child without an open period never appeared. This view
-- starts from children instead, and is built straight from the tables, not on top of
-- learning_period_status:
--
--   period_state  'open'     — has at least one open period: program_count / program_labels /
--                              soonest_days_remaining / paid_count / period_count are filled
--                 'finished' — has periods, all closed  → the app shows "Semua Periode Selesai"
--                 'none'     — no period at all         → the app shows "Belum Memiliki Periode Belajar"
--
-- Each step mirrors the TypeScript it replaces for this screen (src/lib/periodGrouping.ts, which
-- stays for the dashboard, the parent home and the detail page):
--   programs    = groupPeriodsByProgram — per class: active if any period is, days_remaining the
--                 lowest among its ACTIVE periods, labels ordered active first → fewest days → A–Z
--   child_open  = groupPeriodsByChild + tallyPayments — soonest days across programs, paid/total
--                 over every open period (a period without an invoice row counts as unpaid)
--
-- The quota formula (guaranteed_days − non-sick days) is duplicated from learning_period_status.
-- Change both together.
--
-- security_invoker: every table is read under the caller's RLS (admin sees everything). LEFT JOINs
-- for the class label, so a label the caller may not read becomes null rather than dropping a row.
--
-- Grants: SELECT for authenticated and service_role only. A DROP VIEW + CREATE VIEW gets Supabase's
-- default privileges (everything, anon included) and must re-apply these; CREATE OR REPLACE keeps
-- them. The same fix is applied to learning_period_status, which picked up anon privileges when
-- 20261109040000 dropped and recreated it.

CREATE VIEW public.children_learning_period_list
WITH (security_invoker = true) AS
WITH open_periods AS (
  SELECT lp.id,
         lp.child_id,
         lp.classroom_id,
         lp.is_active,
         lp.guaranteed_days - count(ca.id) FILTER (WHERE ca.status <> 'sick'::text) AS days_remaining
    FROM public.children_learning_periods lp
    LEFT JOIN public.children_attendances ca ON ca.learning_period_id = lp.id
   WHERE lp.closed_at IS NULL
   GROUP BY lp.id
), programs AS (
  SELECT op.child_id,
         op.classroom_id,
         bool_or(op.is_active) AS is_active,
         min(op.days_remaining) FILTER (WHERE op.is_active) AS days_remaining,
         count(*) AS period_count,
         count(*) FILTER (WHERE pp.status = 'paid'::text) AS paid_count
    FROM open_periods op
    LEFT JOIN public.payment_periods pp ON pp.learning_period_id = op.id
   GROUP BY op.child_id, op.classroom_id
), child_open AS (
  SELECT p.child_id,
         count(*)::int AS program_count,
         string_agg(cl.label, ', ' ORDER BY p.is_active DESC, p.days_remaining ASC NULLS LAST, cl.label) AS program_labels,
         min(p.days_remaining)::int AS soonest_days_remaining,
         sum(p.paid_count)::int AS paid_count,
         sum(p.period_count)::int AS period_count
    FROM programs p
    LEFT JOIN public.classrooms cl ON cl.id = p.classroom_id
   GROUP BY p.child_id
)
SELECT c.id AS child_id,
       c.full_name AS child_name,
       CASE
         WHEN o.child_id IS NOT NULL THEN 'open'
         WHEN EXISTS (SELECT 1 FROM public.children_learning_periods lp WHERE lp.child_id = c.id) THEN 'finished'
         ELSE 'none'
       END AS period_state,
       o.program_count,
       o.program_labels,
       o.soonest_days_remaining,
       o.paid_count,
       o.period_count
  FROM public.children c
  LEFT JOIN child_open o ON o.child_id = c.id
 WHERE c.active;

COMMENT ON VIEW public.children_learning_period_list IS
  'Periode Belajar list: one row per active child, period_state open/finished/none, with program '
  'count/labels, soonest days remaining and paid/total for open periods. Built from the tables; '
  'its quota formula duplicates learning_period_status — change both together.';

COMMENT ON VIEW public.learning_period_status IS
  'The per-period quota computation. is_active is the stored flag from children_learning_periods. '
  'security_invoker so the policies on children_learning_periods and children_attendances apply to '
  'readers of the view — without it the view would run as its owner and leak every family''s periods. '
  'The same quota formula is duplicated in children_learning_period_list (the Periode Belajar list) — '
  'change both together.';

REVOKE ALL ON public.children_learning_period_list FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.children_learning_period_list TO authenticated, service_role;

REVOKE ALL ON public.learning_period_status FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.learning_period_status TO authenticated, service_role;
