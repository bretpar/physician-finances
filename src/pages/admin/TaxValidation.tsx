// ============================================================================
// Developer-only Tax Engine Validation Suite (route: /admin/tax-validation)
// ============================================================================
// Not linked from any production nav. The route is gated by the same flag
// as taxEngineDiagnostics:  localStorage.setItem("debug:taxEngine", "1")
// If the flag isn't set, the page shows an "enable diagnostics" prompt
// instead of rendering the report, so it stays invisible to normal users.
// ============================================================================

import { useMemo, useState, useEffect } from "react";
import {
  runAllScenarios,
  verifyPageConsistency,
  FIELD_LABELS,
  type ScenarioReport,
  type FieldDiff,
  type PageConsistencyReport,
} from "@/lib/taxValidation";

function isDiagnosticsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("debug:taxEngine") === "1";
  } catch {
    return false;
  }
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtNumber(n: number, isRate: boolean): string {
  if (!Number.isFinite(n)) return "—";
  if (isRate) return `${n.toFixed(4)}%`;
  return fmtCurrency(n);
}

function fmtDelta(n: number, isRate: boolean): string {
  const sign = n > 0 ? "+" : "";
  if (isRate) return `${sign}${n.toFixed(4)} pp`;
  return `${sign}${fmtCurrency(n)}`;
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(3)}%`;
}

function FieldRow({ diff }: { diff: FieldDiff }) {
  return (
    <tr style={{ background: diff.pass ? "transparent" : "#fef2f2" }}>
      <td style={cellStyle}>{FIELD_LABELS[diff.field]}</td>
      <td style={cellStyle}>{fmtNumber(diff.expected, diff.isRate)}</td>
      <td style={cellStyle}>{fmtNumber(diff.actual, diff.isRate)}</td>
      <td style={cellStyle}>{fmtDelta(diff.difference, diff.isRate)}</td>
      <td style={cellStyle}>{fmtPct(diff.percentDifference)}</td>
      <td style={cellStyle}>
        <span style={badgeStyle(diff.pass ? "pass" : "fail")}>
          {diff.pass ? "PASS" : "FAIL"}
        </span>
      </td>
    </tr>
  );
}

function ScenarioCard({ report }: { report: ScenarioReport }) {
  const [open, setOpen] = useState(report.status !== "PASS");
  return (
    <div style={cardStyle}>
      <div
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
        onClick={() => setOpen((o) => !o)}
      >
        <div>
          <div style={{ fontWeight: 600 }}>{report.scenario.name}</div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>
            {report.scenario.category} · {report.scenario.description}
          </div>
        </div>
        <span style={badgeStyle(report.status === "PASS" ? "pass" : report.status === "FAIL" ? "fail" : "warn")}>
          {report.status}
        </span>
      </div>
      {open && report.status !== "NO_BASELINE" && (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={headStyle}>Field</th>
              <th style={headStyle}>Expected</th>
              <th style={headStyle}>Actual</th>
              <th style={headStyle}>Δ</th>
              <th style={headStyle}>% Δ</th>
              <th style={headStyle}>Status</th>
            </tr>
          </thead>
          <tbody>
            {(report.status === "FAIL" ? report.failedFields : report.fields).map((f) => (
              <FieldRow key={f.field} diff={f} />
            ))}
          </tbody>
        </table>
      )}
      {open && report.status === "NO_BASELINE" && (
        <div style={{ marginTop: 8, fontSize: 13, color: "#b45309" }}>
          No baseline entry for <code>{report.scenario.id}</code>. Regenerate
          with <code>npx tsx scripts/generate-tax-validation-expected.ts</code>.
        </div>
      )}
    </div>
  );
}

function ConsistencyReport({ report }: { report: PageConsistencyReport }) {
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 600 }}>
            Page consistency — scope: <code>{report.scope}</code>
          </div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>
            Canonical identity: <code>{report.canonicalIdentityLabel}</code>
          </div>
        </div>
        <span style={badgeStyle(report.ok ? "pass" : "fail")}>
          {report.ok ? "CONSISTENT" : "DRIFT"}
        </span>
      </div>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={headStyle}>Page</th>
            <th style={headStyle}>Registered</th>
            <th style={headStyle}>Shares canonical identity</th>
            <th style={headStyle}>Identity</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((r) => (
            <tr key={r.page} style={{ background: r.registered && r.sharesCanonicalIdentity ? "transparent" : "#fef2f2" }}>
              <td style={cellStyle}>{r.page}</td>
              <td style={cellStyle}>{r.registered ? "yes" : "no"}</td>
              <td style={cellStyle}>{r.registered ? (r.sharesCanonicalIdentity ? "yes" : "no") : "—"}</td>
              <td style={cellStyle}><code>{r.identityLabel}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
      {(report.missing.length > 0 || report.drifted.length > 0) && (
        <div style={{ marginTop: 8, fontSize: 13, color: "#b91c1c" }}>
          {report.missing.length > 0 && (
            <div>Missing consumers: {report.missing.join(", ")}</div>
          )}
          {report.drifted.length > 0 && (
            <div>Pages showing different values than canonical: {report.drifted.join(", ")}</div>
          )}
        </div>
      )}
      <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
        Note: consumers register on mount. Visit each page while this report
        is open (or open them in another tab) to populate the registry.
      </div>
    </div>
  );
}

export default function TaxValidation() {
  const [enabled, setEnabled] = useState(isDiagnosticsEnabled());
  const [tick, setTick] = useState(0);

  const summary = useMemo(() => (enabled ? runAllScenarios() : null), [enabled, tick]);
  const consistency = useMemo(
    () => (enabled ? verifyPageConsistency("actual") : null),
    [enabled, tick],
  );

  useEffect(() => {
    if (!enabled) return;
    // eslint-disable-next-line no-console
    console.info(
      "[taxValidation] scenarios",
      summary?.passed,
      "/",
      summary?.total,
      "passed;",
      summary?.failed,
      "failed;",
      summary?.missingBaseline,
      "missing baseline",
    );
    if (consistency && !consistency.ok) {
      // eslint-disable-next-line no-console
      console.warn("[taxValidation] page consistency drift", consistency);
    }
  }, [enabled, summary, consistency]);

  if (!enabled) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Tax Engine Validation Suite</h1>
        <p style={{ marginTop: 8, color: "#6b7280" }}>
          Developer-only. Enable diagnostics to view this page:
        </p>
        <pre style={preStyle}>localStorage.setItem("debug:taxEngine", "1")</pre>
        <button
          style={buttonStyle}
          onClick={() => {
            try {
              window.localStorage.setItem("debug:taxEngine", "1");
              setEnabled(true);
            } catch {
              /* no-op */
            }
          }}
        >
          Enable diagnostics
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 1100 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Tax Engine Validation Suite</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={buttonStyle} onClick={() => setTick((t) => t + 1)}>
            Re-run
          </button>
          <button
            style={{ ...buttonStyle, background: "#fef3c7", borderColor: "#f59e0b" }}
            onClick={() => {
              window.localStorage.removeItem("debug:taxEngine");
              setEnabled(false);
            }}
          >
            Disable diagnostics
          </button>
        </div>
      </div>

      <div style={{ marginTop: 8, display: "flex", gap: 12 }}>
        <span style={badgeStyle("pass")}>PASS: {summary?.passed ?? 0}</span>
        <span style={badgeStyle("fail")}>FAIL: {summary?.failed ?? 0}</span>
        <span style={badgeStyle("warn")}>No baseline: {summary?.missingBaseline ?? 0}</span>
        <span style={{ color: "#6b7280", fontSize: 13 }}>
          Total scenarios: {summary?.total ?? 0}
        </span>
      </div>

      <h2 style={sectionHeading}>Scenario report</h2>
      {summary?.reports.map((r) => <ScenarioCard key={r.scenario.id} report={r} />)}

      <h2 style={sectionHeading}>Page-level canonical engine consistency</h2>
      {consistency && <ConsistencyReport report={consistency} />}

      <div style={{ marginTop: 24, fontSize: 12, color: "#6b7280" }}>
        Add scenarios in <code>src/lib/taxValidation/scenarios.ts</code>. Regenerate
        the frozen baseline with <code>npx tsx scripts/generate-tax-validation-expected.ts</code>
        only after an intentional engine change.
      </div>
    </div>
  );
}

/* ─── inline styles (kept isolated; no design-system dependency) ─── */
const cardStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: 12,
  marginTop: 12,
  background: "#fff",
};
const tableStyle: React.CSSProperties = {
  width: "100%",
  marginTop: 12,
  borderCollapse: "collapse",
  fontSize: 13,
};
const cellStyle: React.CSSProperties = {
  padding: "6px 8px",
  borderTop: "1px solid #e5e7eb",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
};
const headStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "6px 8px",
  fontWeight: 600,
  background: "#f9fafb",
  borderBottom: "1px solid #e5e7eb",
};
const buttonStyle: React.CSSProperties = {
  padding: "6px 12px",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  background: "#f9fafb",
  cursor: "pointer",
  fontSize: 13,
};
const preStyle: React.CSSProperties = {
  background: "#f3f4f6",
  padding: 8,
  borderRadius: 6,
  fontSize: 12,
  marginTop: 8,
};
const sectionHeading: React.CSSProperties = {
  marginTop: 24,
  fontSize: 16,
  fontWeight: 700,
  color: "#111827",
};

function badgeStyle(kind: "pass" | "fail" | "warn"): React.CSSProperties {
  const palette = {
    pass: { bg: "#dcfce7", fg: "#166534" },
    fail: { bg: "#fee2e2", fg: "#991b1b" },
    warn: { bg: "#fef3c7", fg: "#92400e" },
  }[kind];
  return {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 999,
    background: palette.bg,
    color: palette.fg,
    fontSize: 12,
    fontWeight: 600,
  };
}
