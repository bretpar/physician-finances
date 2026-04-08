import { supabase } from "@/integrations/supabase/client";

/** Fetch the current user's primary organization ID */
export async function getUserOrgId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (error || !data) throw new Error("No organization found");
  return data.organization_id;
}
