
## Customizable Tax Rate & Paycheck Set-Aside Tracker

### What this adds
- A user-adjustable tax set-aside rate (default 20%) instead of the hardcoded 32% federal rate
- A paycheck-by-paycheck tracker showing how much to set aside from each 1099/K-1 payment
- Quarterly payment view that sums set-aside amounts and tells you exactly how much to pay when each quarter is due

### Changes

**1. Add tax settings state** (`src/lib/mockData.ts`)
- Make `federalRate` a parameter to `getSummary` instead of hardcoded 0.32
- Add a `setAsideRate` concept (user's chosen %, e.g. 20%) used for the per-paycheck recommendation
- Keep SE tax (15.3%) and B&O (1.5%) as fixed rates since those are statutory

**2. Update Tax Planning page** (`src/pages/TaxPlanning.tsx`)
- Add a **"Your Set-Aside Rate"** slider/input at the top (range 10–40%, default 20%) stored in component state
- Show a **per-paycheck set-aside table**: for each 1099/K-1 income transaction, show the amount and "set aside X%" recommendation
- Update quarterly estimate cards to show: cumulative set-aside for that quarter's period vs. the calculated liability
- Each quarter card shows: "You set aside $X → Estimated owed: $Y → Pay: $Z"
- Keep the existing tax breakdown section but use the user's chosen rate for federal

**3. Update Dashboard** (`src/pages/Dashboard.tsx`)
- The "Tax Set-Aside Needed" card uses the user's rate instead of 32%
- Show the set-aside rate in the trend text (e.g. "20% of 1099/K-1 income")

**4. Persist rate in localStorage**
- Save the chosen set-aside rate to `localStorage` so it persists across sessions
- Create a small `useTaxSettings` hook to read/write the rate

### Tax logic change
- **Old**: Federal tax = netProfit × 32% (fixed)
- **New**: Set-aside recommendation = selfEmploymentIncome × userRate (e.g. 20%)
- Quarterly payment = (set-aside from 1099/K-1 income for that quarter) — still shows SE tax and B&O as separate line items
- The set-aside rate is the user's personal target, not the statutory rate — it's what they want to put aside per paycheck based on their historical effective rate
