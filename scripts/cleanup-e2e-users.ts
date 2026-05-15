/**
 * List disposable E2E users (created by e2e/helpers/seed.ts).
 *
 * Disposable users live under @paycheckmd-e2e.test and are intentionally NOT
 * auto-deleted. Run this script to inspect them. Actual deletion of auth users
 * requires the service-role key which is not bundled with this harness — paste
 * the listed user_ids into the backend admin UI to remove them.
 *
 * Usage:
 *   bunx tsx scripts/cleanup-e2e-users.ts
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ?? "https://fiqnxprhvsadcqicczkg.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZpcW54cHJodnNhZGNxaWNjemtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2NjQ1OTIsImV4cCI6MjA5MTI0MDU5Mn0.zLfB4BgxOjdFt4BYdmIZ_j3UpMkadSiU_LezbC35XP0";

async function main() {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  // profiles is RLS-restricted, so this anon listing is informational only —
  // it returns nothing without a session. The intent is to document the
  // tagging convention for operators with database access.
  console.log("Disposable E2E users are tagged with:");
  console.log("  email LIKE 'e2e+%@paycheckmd-e2e.test'");
  console.log();
  console.log("To list them with database access run:");
  console.log("  SELECT id, email, created_at FROM auth.users");
  console.log("    WHERE email LIKE 'e2e+%@paycheckmd-e2e.test'");
  console.log("    ORDER BY created_at DESC;");
  console.log();
  console.log("To purge (requires service role):");
  console.log("  DELETE FROM auth.users WHERE email LIKE 'e2e+%@paycheckmd-e2e.test';");
  void client; // suppress unused warning
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
