-- Deleting a family (e.g. a duplicate created because father/mother names aren't validated for
-- uniqueness) currently fails with a FK violation the moment it has any child, and deleting a
-- child fails the same way the moment it has any classroom history, learning period, attendance,
-- daily report, or invoice. Re-point every FK that hangs off children/families so a plain
-- `DELETE FROM families WHERE id = ...` (already allowed by admin_all_families, an existing FOR
-- ALL policy) cascades through the child's entire operational history in one transaction.
--
-- registration_submissions.family_id and registration_children.child_id are deliberately left as
-- SET NULL instead of CASCADE: both are described in their own comments as an audit trail back to
-- the form a parent actually filled in, and severing that link on delete (rather than destroying
-- the submission itself) preserves that trail.

ALTER TABLE public.children
  DROP CONSTRAINT children_family_id_fkey,
  ADD CONSTRAINT children_family_id_fkey
    FOREIGN KEY (family_id) REFERENCES public.families(id) ON DELETE CASCADE;

ALTER TABLE public.children_classrooms
  DROP CONSTRAINT children_classrooms_child_id_fkey,
  ADD CONSTRAINT children_classrooms_child_id_fkey
    FOREIGN KEY (child_id) REFERENCES public.children(id) ON DELETE CASCADE;

ALTER TABLE public.learning_periods
  DROP CONSTRAINT learning_periods_child_id_fkey,
  ADD CONSTRAINT learning_periods_child_id_fkey
    FOREIGN KEY (child_id) REFERENCES public.children(id) ON DELETE CASCADE;

ALTER TABLE public.child_attendances
  DROP CONSTRAINT child_attendances_period_fkey,
  ADD CONSTRAINT child_attendances_period_fkey
    FOREIGN KEY (learning_period_id, child_id, classroom_id)
    REFERENCES public.learning_periods (id, child_id, classroom_id) ON DELETE CASCADE;

ALTER TABLE public.daily_reports
  DROP CONSTRAINT daily_reports_child_id_fkey,
  ADD CONSTRAINT daily_reports_child_id_fkey
    FOREIGN KEY (child_id) REFERENCES public.children(id) ON DELETE CASCADE;

ALTER TABLE public.payment_periods
  DROP CONSTRAINT payment_periods_child_id_fkey,
  ADD CONSTRAINT payment_periods_child_id_fkey
    FOREIGN KEY (child_id) REFERENCES public.children(id) ON DELETE CASCADE,
  DROP CONSTRAINT payment_periods_learning_period_id_fkey,
  ADD CONSTRAINT payment_periods_learning_period_id_fkey
    FOREIGN KEY (learning_period_id) REFERENCES public.learning_periods(id) ON DELETE CASCADE;

ALTER TABLE public.registration_submissions
  DROP CONSTRAINT registration_submissions_family_id_fkey,
  ADD CONSTRAINT registration_submissions_family_id_fkey
    FOREIGN KEY (family_id) REFERENCES public.families(id) ON DELETE SET NULL;

ALTER TABLE public.registration_children
  DROP CONSTRAINT registration_children_child_id_fkey,
  ADD CONSTRAINT registration_children_child_id_fkey
    FOREIGN KEY (child_id) REFERENCES public.children(id) ON DELETE SET NULL;
