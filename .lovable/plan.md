
## Plan: Conditional Source/Employer + Advanced Collapsible in Personal Income form

### Changes (single file: `src/pages/PersonalIncome.tsx`)

**1. Show "Source / Employer" only for W2 income types**
- Wrap the entire `<SourceEmployerCombobox>` block (lines 521–561) in `{isW2Type(form.income_type) && (...)}`.
- When the user switches to a non-W2 type, the field is removed from the UI.
- Update `validateSource()` to only require a source when `isW2Type(form.income_type)` is true; non-W2 entries skip the source validation entirely.
- In `saveForm()`, the `payloadSourceId` and `source_name` logic already gracefully handles empty values, so non-W2 entries will save with no linked source / empty company name.

**2. Move "Withholding & Deductions" + "Notes" into an Advanced collapsible (matching Business Activity)**
- Add imports: `Collapsible, CollapsibleTrigger, CollapsibleContent` from `@/components/ui/collapsible` and `ChevronDown, ChevronRight` from `lucide-react`.
- Add state: `const [advancedOpen, setAdvancedOpen] = useState(false);`
- Reset `setAdvancedOpen(false)` in `openAdd()`; in `openEdit()` auto-open it when any of `federal_withholding / state_withholding / retirement_pretax / deductions_pre_tax / additional_tax_reserve / notes` are non-empty.
- Wrap the following existing blocks inside one `<Collapsible>` with a "Advanced details" trigger styled the same as Business Activity:
  - W2 "Withholding & Deductions" panel (lines 602–627)
  - Non-W2 federal/state withholding grid (lines 629–641)
  - Additional Tax Reserve (edit-only) field (lines 643–650)
  - Notes field (lines 652–655)
- Stock-specific Cost Basis / Realized Gain/Loss block (lines 588–600) stays in the main form (it's structural to the entry, not "advanced").
- The Estimated Tax Reserve preview (lines 657–681) and Attachments stay below the collapsible.

### Behavior summary
- Source/Employer field appears only when Income Type is "W2 Income (You)" or "W2 Income (Partner)".
- All withholdings, deductions, retirement, additional reserve, and notes live under a collapsible "Advanced details" section, closed by default for new entries and auto-opened when editing an entry that has any of those values set.
- No schema, hook, or other-page changes required.
