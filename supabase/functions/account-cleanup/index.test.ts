import { eraseUserData, USER_SCOPED_FINANCIAL_TABLES } from "./index.ts";

type Row = Record<string, unknown>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function createMockAdmin(targetUserId: string, otherUserId: string) {
  const tables: Record<string, Row[]> = {};
  for (const table of USER_SCOPED_FINANCIAL_TABLES) {
    tables[table] = [
      { id: `${table}-target`, user_id: targetUserId, amount: 132000 },
      { id: `${table}-other`, user_id: otherUserId, amount: 999 },
    ];
  }
  tables.tax_settings = [
    {
      id: "settings-target",
      user_id: targetUserId,
      organization_id: "org-target",
      onboarding_complete: true,
      onboarding_step: 3,
      filing_status: "married_filing_jointly",
      state_of_residence: "WA",
      ytd_catchup_choice: "yes",
    },
    { id: "settings-other", user_id: otherUserId, organization_id: "org-other", onboarding_complete: true },
  ];
  tables.profiles = [
    { id: "profile-target", user_id: targetUserId, email: "target@example.com", first_name: "Codex", last_name: "User" },
    { id: "profile-other", user_id: otherUserId, email: "other@example.com", first_name: "Other", last_name: "User" },
  ];

  const admin = {
    tables,
    storage: {
      from: () => ({
        list: async () => ({ data: [] }),
        remove: async () => ({ data: [] }),
      }),
    },
    from(table: string) {
      let operation: "select" | "delete" | "update" | null = null;
      let updatePayload: Row = {};
      const filters: Array<[string, unknown]> = [];
      const applyFilters = (rows: Row[]) => rows.filter((row) => filters.every(([col, val]) => row[col] === val));
      const builder = {
        select: () => {
          operation = "select";
          return builder;
        },
        delete: () => {
          operation = "delete";
          return builder;
        },
        update: (payload: Row) => {
          operation = "update";
          updatePayload = payload;
          return builder;
        },
        upsert: async (payload: Row) => {
          const rows = tables[table] || (tables[table] = []);
          const idx = rows.findIndex((row) => row.user_id === payload.user_id);
          if (idx >= 0) rows[idx] = { ...rows[idx], ...payload };
          else rows.push(payload);
          return { error: null };
        },
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          if (operation === "delete") {
            tables[table] = (tables[table] || []).filter((row) => !filters.every(([col, val]) => row[col] === val));
            return Promise.resolve({ error: null });
          }
          if (operation === "update") {
            tables[table] = (tables[table] || []).map((row) =>
              filters.every(([col, val]) => row[col] === val) ? { ...row, ...updatePayload } : row,
            );
            return Promise.resolve({ error: null });
          }
          return builder;
        },
        maybeSingle: async () => ({ data: applyFilters(tables[table] || [])[0] ?? null, error: null }),
      };
      return builder;
    },
  };

  return admin;
}

Deno.test("safe erase clears user financial rows and preserves identity", async () => {
  const targetUserId = "user-target";
  const otherUserId = "user-other";
  const admin = createMockAdmin(targetUserId, otherUserId);

  await eraseUserData(admin, targetUserId);

  for (const table of USER_SCOPED_FINANCIAL_TABLES) {
    assert(!admin.tables[table].some((row) => row.user_id === targetUserId), `${table} still has target rows`);
    assert(admin.tables[table].some((row) => row.user_id === otherUserId), `${table} removed another user's rows`);
  }

  const targetProfile = admin.tables.profiles.find((row) => row.user_id === targetUserId);
  assert(targetProfile, "profile identity row was deleted");
  assert(targetProfile.email === "target@example.com", "profile email was changed");
  assert(targetProfile.first_name === "", "profile first name was not reset");

  const targetSettings = admin.tables.tax_settings.find((row) => row.user_id === targetUserId);
  assert(targetSettings, "tax settings row was deleted");
  assert(targetSettings.onboarding_complete === false, "onboarding_complete was not reset");
  assert(targetSettings.onboarding_step === 1, "onboarding_step was not reset");
  assert(targetSettings.filing_status === "single", "tax profile was not reset");
});