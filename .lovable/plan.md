Update the onboarding YTD catch-up flow to match the income type selected in Step 2.

### Changes

1. **Onboarding.tsx**  
   - Import `IncomeProfileType`.  
   - Pass `incomeProfileType={merged.incomeProfileType}` into `<YtdCatchupForm />`.  
   - Replace the hard-coded Step-3 form heading with a dynamic heading based on `merged.incomeProfileType`:
     - `w2_only` → "Add your W-2 income from earlier this year"  
     - `w2_plus_business` → "Add your income earned so far this year"  
     - `business_only` → "Add your business income earned so far this year"

2. **YtdCatchupForm.tsx**  
   - Add `incomeProfileType?: IncomeProfileType` to the component props.  
   - Conditionally drive the UI based on that prop:
     - **Source-type dropdown** – locked / hidden for single-type profiles; shown for `w2_plus_business`.  
     - **W-2-only fields (Social Security, Medicare)** – visible only for W-2 sources.  
     - **Tax-field labels** – for 1099-only profiles, label them as *estimated taxes paid* ("Federal estimated taxes paid YTD", "State estimated taxes paid YTD").  
     - **Description copy** – tailored to each profile.  
   - Keep the existing overlap warning, saved-entry count, and aggregate logic untouched.

No schema, hook, or backend changes are required.