import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { execSync } from "child_process";
import fs from "fs";
import type { Plugin } from "vite";
import { ROUTE_META } from "./src/lib/routeMeta";

// Writes dist/<route>/index.html with route-specific head tags so crawlers that
// don't run JS see each public page's own title and description.
const STATIC_HEAD_ROUTES = [
  "/estimate", "/trust", "/login", "/signup",
  ...ROUTE_META.map((r) => r.pattern).filter((p) => p.startsWith("/blog/")),
];
function esc(v: string) {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
function staticRouteHead(): Plugin {
  return {
    name: "static-route-head",
    apply: "build",
    closeBundle() {
      const dist = path.resolve(__dirname, "dist");
      const indexPath = path.join(dist, "index.html");
      if (!fs.existsSync(indexPath)) return;
      const base = fs.readFileSync(indexPath, "utf-8");
      for (const route of STATIC_HEAD_ROUTES) {
        const meta = ROUTE_META.find((r) => r.pattern === route)?.meta;
        if (!meta) continue;
        const url = `https://app.paycheckmd.com${route}`;
        const t = esc(meta.title), d = esc(meta.description);
        let html = base
          .replace(/<title>[\s\S]*?<\/title>/, `<title>${t}</title>`)
          .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${d}" />`)
          .replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${t}" />`)
          .replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${d}" />`)
          .replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${url}" />`)
          .replace(/<meta property="og:type"[^>]*>/, `<meta property="og:type" content="${meta.type ?? "website"}" />`)
          .replace(/<meta name="twitter:title"[^>]*>/, `<meta name="twitter:title" content="${t}" />`)
          .replace(/<meta name="twitter:description"[^>]*>/, `<meta name="twitter:description" content="${d}" />`);
        if (!/rel="canonical"/.test(html)) html = html.replace("</head>", `  <link rel="canonical" href="${url}" />\n  </head>`);
        const out = path.join(dist, route.slice(1), "index.html");
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, html);
      }
    },
  };
}

function resolveBuildInfo(mode: string) {
  let appVersion = "Unavailable";
  try {
    const pkg = JSON.parse(fs.readFileSync("./package.json", "utf-8"));
    appVersion = pkg.version || "Unavailable";
  } catch {
    /* ignore */
  }

  let gitCommit = "Unavailable";
  try {
    gitCommit = execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    /* ignore */
  }

  const buildTimestamp = new Date().toISOString();
  const environmentLabel = process.env.VERCEL_ENV || process.env.VITE_ENVIRONMENT_LABEL || mode;

  return {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_TIMESTAMP__: JSON.stringify(buildTimestamp),
    __GIT_COMMIT__: JSON.stringify(gitCommit),
    __ENVIRONMENT_LABEL__: JSON.stringify(environmentLabel),
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  define: resolveBuildInfo(mode),
  plugins: [react(), staticRouteHead(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
