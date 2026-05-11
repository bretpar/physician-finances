
DROP POLICY IF EXISTS "Admins/owners can update org members" ON public.organization_members;

CREATE POLICY "Admins/owners can update org members"
ON public.organization_members
FOR UPDATE
TO authenticated
USING (public.is_org_admin_or_owner(auth.uid(), organization_id))
WITH CHECK (
  public.is_org_admin_or_owner(auth.uid(), organization_id)
  AND (
    role <> 'owner'
    OR public.has_org_role(auth.uid(), organization_id, 'owner')
  )
);
