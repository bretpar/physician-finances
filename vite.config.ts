import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { execSync } from "child_process";
import fs from "fs";

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
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
