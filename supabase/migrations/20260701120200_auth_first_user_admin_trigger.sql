-- Promotes the first row in auth.users to app_metadata.role = 'admin' (signup bootstrap only).
-- Later signups are unaffected. Remove this trigger after onboarding if you prefer manual admin assignment.

CREATE OR REPLACE FUNCTION public.promote_first_auth_user_to_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT COUNT(*)::int FROM auth.users) = 1 THEN
    UPDATE auth.users
    SET raw_app_meta_data =
      COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'admin')
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_promote_first_user_admin ON auth.users;

CREATE TRIGGER trg_promote_first_user_admin
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.promote_first_auth_user_to_admin();
