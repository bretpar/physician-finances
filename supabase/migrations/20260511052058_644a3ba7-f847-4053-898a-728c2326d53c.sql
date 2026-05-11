CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_org_id uuid;
  existing_org_id uuid;
BEGIN
  -- Reuse existing org if profile already created (idempotent re-runs)
  SELECT organization_id INTO existing_org_id FROM public.profiles WHERE user_id = NEW.id LIMIT 1;

  IF existing_org_id IS NULL THEN
    INSERT INTO public.organizations (name, owner_user_id)
    VALUES (
      COALESCE(NULLIF(NEW.raw_user_meta_data->>'first_name', ''), NULLIF(NEW.raw_user_meta_data->>'full_name', ''), split_part(NEW.email, '@', 1), 'New User'),
      NEW.id
    )
    RETURNING id INTO new_org_id;
  ELSE
    new_org_id := existing_org_id;
  END IF;

  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (new_org_id, NEW.id, 'owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO public.profiles (user_id, email, organization_id, first_name, last_name)
  VALUES (
    NEW.id,
    NEW.email,
    new_org_id,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', '')
  )
  ON CONFLICT (user_id) DO UPDATE
  SET email = EXCLUDED.email,
      organization_id = COALESCE(public.profiles.organization_id, EXCLUDED.organization_id);

  INSERT INTO public.tax_settings (user_id, organization_id)
  VALUES (NEW.id, new_org_id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block account creation due to setup row failures; log to Postgres logs
  RAISE WARNING 'handle_new_user setup failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();