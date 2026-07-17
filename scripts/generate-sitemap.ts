// Runs before `vite dev` and `vite build` (predev/prebuild hooks); writes public/sitemap.xml.

import { writeFileSync } from "fs";
import { resolve } from "path";

const BASE_URL = "https://app.paycheckmd.com";

interface SitemapEntry {
  path: string;
  lastmod?: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
}

const today = new Date().toISOString().split("T")[0];

const entries: SitemapEntry[] = [
  { path: "/", changefreq: "weekly", priority: "1.0", lastmod: today },
  { path: "/login", changefreq: "monthly", priority: "0.5", lastmod: today },
  { path: "/signup", changefreq: "monthly", priority: "0.5", lastmod: today },
  { path: "/reset-password", changefreq: "monthly", priority: "0.3", lastmod: today },
  { path: "/onboarding", changefreq: "monthly", priority: "0.4", lastmod: today },
  { path: "/business-activity", changefreq: "weekly", priority: "0.8", lastmod: today },
  { path: "/personal-income", changefreq: "weekly", priority: "0.8", lastmod: today },
  { path: "/income", changefreq: "weekly", priority: "0.8", lastmod: today },
  { path: "/investments", changefreq: "weekly", priority: "0.8", lastmod: today },
  { path: "/projected-income", changefreq: "weekly", priority: "0.7", lastmod: today },
  { path: "/deductions", changefreq: "weekly", priority: "0.7", lastmod: today },
  { path: "/taxes", changefreq: "weekly", priority: "0.9", lastmod: today },
  { path: "/tax-planning", changefreq: "weekly", priority: "0.8", lastmod: today },
  { path: "/transactions", changefreq: "weekly", priority: "0.7", lastmod: today },
  { path: "/accounts", changefreq: "weekly", priority: "0.6", lastmod: today },
  { path: "/mileage", changefreq: "weekly", priority: "0.7", lastmod: today },
  { path: "/stocks", changefreq: "weekly", priority: "0.7", lastmod: today },
  { path: "/reports", changefreq: "weekly", priority: "0.7", lastmod: today },
  { path: "/settings", changefreq: "monthly", priority: "0.4", lastmod: today },
  { path: "/estimate", changefreq: "monthly", priority: "0.7", lastmod: today },
  { path: "/tax-reserve", changefreq: "weekly", priority: "0.7", lastmod: today },
  { path: "/quarterly-taxes", changefreq: "weekly", priority: "0.7", lastmod: today },
  { path: "/estimated-tax", changefreq: "weekly", priority: "0.7", lastmod: today },
  // Intentionally excluded (internal/admin, non-indexable): /debug/transactions, /admin/data-isolation
  { path: "/blog/1099-tax-deductions", changefreq: "monthly", priority: "0.8", lastmod: today },
  { path: "/blog/physician-scorp-vs-sole-proprietorship", changefreq: "monthly", priority: "0.8", lastmod: today },
];

function generateSitemap(entries: SitemapEntry[]) {
  const urls = entries.map((e) =>
    [
      `  <url>`,
      `    <loc>${BASE_URL}${e.path}</loc>`,
      e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>` : null,
      e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
      e.priority ? `    <priority>${e.priority}</priority>` : null,
      `  </url>`,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...urls,
    `</urlset>`,
  ].join("\n");
}

writeFileSync(resolve("public/sitemap.xml"), generateSitemap(entries));
console.log(`sitemap.xml written (${entries.length} entries)`);
