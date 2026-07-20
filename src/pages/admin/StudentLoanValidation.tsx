/**
 * Developer-only Student Loan Registry Validation Suite
 * Route: /admin/student-loan-validation
 *
 * Gated by localStorage flag `debug:studentLoan=1`. Not linked from the app.
 * Surfaces every plan's status, effective dates, source URL, verification
 * state, and the results of a lightweight self-check.
 */

import { useMemo, useState } from "react";
import { PLANS, REGISTRY_VERSION } from "@/lib/studentLoan/rules/plans";
import { POVERTY_GUIDELINES, latestPovertyYear } from "@/lib/studentLoan/rules/povertyGuidelines";
import { computePlanPayment, PlanUnavailableError } from "@/lib/studentLoan/computePlanPayment";

function isEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try { return window.localStorage.getItem("debug:studentLoan") === "1"; } catch { return false; }
}

interface Check { plan: string; ok: boolean; note: string; }

function runSelfCheck(): Check[] {
  const results: Check[] = [];
  const borrower = {
    agi: 100_000, familySize: 2, region: "contiguous_48_dc" as const,
    filingStatus: "married_filing_jointly" as const, spouseAgi: 0, dependents: 1,
    ibrBorrowerType: "new_2014" as const, isParentPlus: false,
  };
  const loan = { balance: 200_000, interestRatePct: 6.5 };
  for (const p of PLANS) {
    try {
      if (p.status === "closed" || p.status === "historical") {
        try {
          computePlanPayment(p.id, loan, borrower);
          results.push({ plan: p.id, ok: false, note: "Expected PlanUnavailableError but succeeded." });
        } catch (e) {
          if (e instanceof PlanUnavailableError) {
            results.push({ plan: p.id, ok: true, note: "Correctly refuses to estimate." });
          } else {
            results.push({ plan: p.id, ok: false, note: String(e) });
          }
        }
        continue;
      }
      const r = computePlanPayment(p.id, loan, borrower);
      if (r.monthlyPayment < 0) throw new Error("negative payment");
      results.push({
        plan: p.id, ok: true,
        note: `monthly $${r.monthlyPayment} · eligibility=${r.eligibility}`,
      });
    } catch (e) {
      results.push({ plan: p.id, ok: false, note: String((e as Error).message) });
    }
  }
  return results;
}

const cell: React.CSSProperties = { padding: "6px 8px", borderTop: "1px solid #e5e7eb", fontSize: 13 };
const head: React.CSSProperties = { ...cell, background: "#f9fafb", fontWeight: 600, borderTop: 0 };

export default function StudentLoanValidation() {
  const [enabled, setEnabled] = useState(isEnabled());
  const checks = useMemo(() => (enabled ? runSelfCheck() : []), [enabled]);
  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.length - passed;

  if (!enabled) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Student Loan Registry Validation</h1>
        <p style={{ marginTop: 8, color: "#6b7280" }}>Developer-only. Enable diagnostics:</p>
        <pre style={{ background: "#f3f4f6", padding: 8, borderRadius: 6, fontSize: 12, marginTop: 8 }}>
          localStorage.setItem("debug:studentLoan", "1")
        </pre>
        <button
          style={{ padding: "6px 12px", border: "1px solid #d1d5db", borderRadius: 6, background: "#f9fafb", cursor: "pointer", fontSize: 13 }}
          onClick={() => { try { window.localStorage.setItem("debug:studentLoan", "1"); setEnabled(true); } catch {} }}
        >
          Enable diagnostics
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 1200 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>Student Loan Registry Validation</h1>
      <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 13 }}>
        <span>Registry version: <code>{REGISTRY_VERSION}</code></span>
        <span>Poverty year in use: <code>{latestPovertyYear()}</code></span>
        <span style={{ color: "#166534" }}>PASS: {passed}</span>
        <span style={{ color: "#991b1b" }}>FAIL: {failed}</span>
      </div>

      <h2 style={{ marginTop: 24, fontSize: 16, fontWeight: 700 }}>Plans</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
        <thead>
          <tr>
            <th style={head}>ID</th>
            <th style={head}>Name</th>
            <th style={head}>Status</th>
            <th style={head}>Family</th>
            <th style={head}>Effective</th>
            <th style={head}>Verification</th>
            <th style={head}>Self-check</th>
            <th style={head}>Source</th>
          </tr>
        </thead>
        <tbody>
          {PLANS.map((p) => {
            const chk = checks.find((c) => c.plan === p.id);
            const badBg = p.verification === "pending" || (chk && !chk.ok) ? "#fef2f2" : "transparent";
            return (
              <tr key={p.id} style={{ background: badBg }}>
                <td style={cell}><code>{p.id}</code></td>
                <td style={cell}>{p.displayName}</td>
                <td style={cell}>{p.status}</td>
                <td style={cell}>{p.family}</td>
                <td style={cell}>{p.effectiveStart ?? "—"}{p.effectiveEnd ? ` → ${p.effectiveEnd}` : ""}</td>
                <td style={cell}>{p.verification}</td>
                <td style={cell}>{chk ? (chk.ok ? "✓ " : "✗ ") + chk.note : "—"}</td>
                <td style={cell}><a href={p.sourceUrl} target="_blank" rel="noreferrer">source</a> ({p.sourceUpdatedAt})</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2 style={{ marginTop: 24, fontSize: 16, fontWeight: 700 }}>Poverty guidelines</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
        <thead>
          <tr>
            <th style={head}>Year</th>
            <th style={head}>Region</th>
            <th style={head}>Base (family 1)</th>
            <th style={head}>Per additional</th>
            <th style={head}>Verification</th>
            <th style={head}>Published</th>
          </tr>
        </thead>
        <tbody>
          {POVERTY_GUIDELINES.map((g, i) => (
            <tr key={i} style={{ background: g.verification === "pending" ? "#fef2f2" : "transparent" }}>
              <td style={cell}>{g.year}</td>
              <td style={cell}>{g.region}</td>
              <td style={cell}>${g.base.toLocaleString()}</td>
              <td style={cell}>${g.perAdditionalPerson.toLocaleString()}</td>
              <td style={cell}>{g.verification}</td>
              <td style={cell}>{g.publishedAt}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ marginTop: 24, fontSize: 12, color: "#6b7280" }}>
        Update rules in <code>src/lib/studentLoan/rules/</code>. Bump <code>REGISTRY_VERSION</code>
        when the source date changes and re-run <code>vitest run src/test/studentLoan</code>.
      </p>
    </div>
  );
}
