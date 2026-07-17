// Regenerate the frozen baseline for the Tax Validation Suite.
// Run with:  npx tsx scripts/generate-tax-validation-expected.ts
//
// The output file (src/lib/taxValidation/expected.generated.json) is what
// runValidation.ts diffs against. Regenerate it ONLY after an intentional,
// reviewed change to the tax engine — that's the point of the baseline.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateBaseline } from "../src/lib/taxValidation/runValidation";

const out = resolve(process.cwd(), "src/lib/taxValidation/expected.generated.json");
const baseline = generateBaseline();
writeFileSync(out, JSON.stringify(baseline, null, 2) + "\n", "utf8");
// eslint-disable-next-line no-console
console.log(`Wrote ${Object.keys(baseline).length} scenarios to ${out}`);
