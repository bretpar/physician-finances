DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_roles_user_id_fkey'
      AND conrelid = 'public.user_roles'::regclass
  ) THEN
    ALTER TABLE public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;

DROP POLICY IF EXISTS "Super admins can view all roles" ON public.user_roles;
CREATE POLICY "Super admins can view all roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));

INSERT INTO public.user_roles (user_id, role)
SELECT au.id, 'super_admin'::public.app_role
FROM auth.users au
WHERE lower(au.email) = lower('brendanparkermd@gmail.com')
ON CONFLICT (user_id, role) DO NOTHING;