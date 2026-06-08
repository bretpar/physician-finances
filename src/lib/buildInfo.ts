export interface BuildInfo {
  version: string;
  timestamp: string;
  commit: string;
  environment: string;
}

export function getBuildInfo(): BuildInfo {
  return {
    version: typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "Unavailable",
    timestamp: typeof __BUILD_TIMESTAMP__ !== "undefined" ? __BUILD_TIMESTAMP__ : "Unavailable",
    commit: typeof __GIT_COMMIT__ !== "undefined" ? __GIT_COMMIT__ : "Unavailable",
    environment: typeof __ENVIRONMENT_LABEL__ !== "undefined" ? __ENVIRONMENT_LABEL__ : "Unavailable",
  };
}
