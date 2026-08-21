import "@testing-library/jest-dom";

// Node-environment test files (e.g. executable Postgres fixtures) have no DOM.
if (typeof window === "undefined") {
  // nothing to patch
} else
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
