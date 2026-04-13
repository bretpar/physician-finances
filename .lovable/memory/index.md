# Project Memory

## Core
Physician finance app — income/expense tracking, tax planning, WA B&O tax.
Fintech design: light theme, Inter font, blue primary (#0066CC), teal accent.
Three-section income architecture: Business Activity, Personal Income, Income Planner.
Feature tiering: core vs advanced in src/lib/featureFlags.ts — all unlocked today.

## Memories
- [Tax rates](mem://features/tax-rates) — Federal, SE, WA B&O rates used in calculations
- [Withholding engine](mem://features/withholding-engine) — Smart tax withholding using projected annual income + marginal brackets
- [Income architecture](mem://features/income-architecture) — Business Activity, Personal Income, Income Planner separation + feature tiering + dual-mode tax engine
