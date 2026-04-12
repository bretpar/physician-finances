

## Restore Projected Income Page

The `/projected-income` route is currently redirecting to `/` (line 47 of App.tsx), and there's no nav link for it. Two changes needed:

### 1. App.tsx
- Remove the redirect on line 47
- Add a proper route: `<Route path="/projected-income" element={<ProjectedIncome />} />`
- Add the import for `ProjectedIncome`

### 2. AppLayout.tsx
- Add a nav item for "Income Planner" (or "Projected Income") using the `TrendingUp` icon from lucide-react
- Place it after "Transactions" in the nav list

