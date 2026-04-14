import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // Verify the requesting user is authenticated and is admin/owner
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Not authenticated");

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: callingUser } } = await supabaseUser.auth.getUser();
    if (!callingUser) throw new Error("Not authenticated");

    const { email, firstName, lastName, organizationId, role } = await req.json();

    if (!email || !organizationId) {
      throw new Error("Missing required fields: email and organizationId");
    }

    // Validate role - never allow inviting as owner
    const inviteRole = role || "member";
    if (inviteRole === "owner") {
      throw new Error("Cannot invite users with owner role");
    }

    // Verify caller is admin/owner of the org
    const { data: callerMembership } = await supabaseAdmin
      .from("organization_members")
      .select("role")
      .eq("user_id", callingUser.id)
      .eq("organization_id", organizationId)
      .single();

    if (!callerMembership || !["owner", "admin"].includes(callerMembership.role)) {
      throw new Error("Insufficient permissions");
    }

    // Invite user via magic link (no plaintext password)
    const { data: newUser, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: {
        first_name: firstName || "",
        last_name: lastName || "",
        full_name: `${firstName || ""} ${lastName || ""}`.trim(),
        invited_to_org: organizationId,
        invited_role: inviteRole,
      },
    });

    if (inviteError) throw inviteError;
    if (!newUser.user) throw new Error("Failed to invite user");

    // The trigger will auto-create an org for this user, but we want to add them to the inviter's org
    const { error: memberError } = await supabaseAdmin
      .from("organization_members")
      .insert({
        organization_id: organizationId,
        user_id: newUser.user.id,
        role: inviteRole,
      });

    if (memberError) throw memberError;

    // Update the profile's organization_id to the invited org
    await supabaseAdmin
      .from("profiles")
      .update({ organization_id: organizationId })
      .eq("user_id", newUser.user.id);

    return new Response(JSON.stringify({ success: true, userId: newUser.user.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
