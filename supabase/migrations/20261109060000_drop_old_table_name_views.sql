-- Drop the pass-through views 20261109050000 left under the old table names. They only bridged
-- the gap until the frontend build that queries children_attendances / children_learning_periods
-- was live on Vercel. Nothing in the database depends on them.

BEGIN;

DROP VIEW public.child_attendances;
DROP VIEW public.learning_periods;

COMMIT;
