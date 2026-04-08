
## Authentication & Multi-Tenant Architecture

### Important Notes
- Lovable Cloud handles password hashing, sessions, and auth tokens automatically — no manual bcrypt needed
- The initial admin user will be created via the signup flow (not pre-seeded), since auth systems don't allow inserting passwords via SQL
- "Require password change on first login" isn't natively supported, but we can add a flag

### Phase 1: Database Schema

**1a. Create `organizations` table**
- `id`, `name`, `owner_user_id`, `created_at`, `updated_at`
- RLS: members can view their own org

**1b. Create `organization_members` table**
- `user_id`, `organization_id`, `role` (enum: owner, admin, member)
- RLS: members can view their own org's members; owners/admins can manage

**1c. Create `app_role` enum**
- Values: `owner`, `admin`, `member`

**1d. Create `has_org_role()` security definer function**
- Prevents RLS recursion when checking roles

**1e. Add `organization_id` to all existing tables**
- `transactions`, `companies`, `income_forecasts`, `tax_settings`, `profiles`, `plaid_items`, `mileage_entries`
- Nullable initially (for migration safety), then scoped in queries

**1f. Update all RLS policies**
- Add organization-scoped access: users can only access data within their org
- Use the security definer function for role checks

### Phase 2: Auth UI

**2a. Create Login page** (`/login`)
- Email + password form
- Password validation (8+ chars, number, special char)
- Clean, professional design matching app theme

**2b. Create Signup page** (`/signup`)
- For the initial admin: sign up with brendanparkermd@gmail.com
- Auto-creates organization "Brendan Parker MD" and assigns owner role
- Future users will be invited (signup can be restricted later)

**2c. Create Auth guard component**
- Wrap all routes — redirect to `/login` if not authenticated
- Use `onAuthStateChange` listener

**2d. Add logout button** to sidebar

### Phase 3: Organization & Team Management

**3a. Auto-provision on first login**
- On signup: create org, add user as owner, create profile
- Use a database trigger on `auth.users` insert

**3b. Team management page** (`/team`)
- List org members with roles
- Owner/Admin can invite users (email input → creates auth user + org member)
- Owner/Admin can change roles, remove members
- Members see read-only list

**3c. Show org name in header**

### Phase 4: Data Migration

**4a. Backfill `organization_id`** on existing rows (if any exist)
**4b. Update all hooks/queries** to include `organization_id`
**4c. Update all insert mutations** to include `organization_id`

### What this does NOT include (future-ready)
- Multi-org membership (schema supports it, UI doesn't)
- Billing integration (placeholder only)
- Invitation links (uses direct user creation for now)
- Email verification (can enable later)
