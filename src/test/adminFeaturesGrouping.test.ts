import { describe, expect, it } from "vitest";
import {
  FEATURE_REGISTRY,
  OTHER_FEATURE_GROUP_ID,
  featureMatchesQuery,
  getFeatureType,
  groupFeaturesByPage,
} from "@/lib/featureRegistry";

describe("admin features grouping", () => {
  const groups = groupFeaturesByPage(FEATURE_REGISTRY);

  it("creates one group per page-level feature", () => {
    const pages = FEATURE_REGISTRY.filter((e) => getFeatureType(e) === "page");
    const pageGroups = groups.filter((g) => g.id !== OTHER_FEATURE_GROUP_ID);
    expect(pageGroups.length).toBe(pages.length);
    expect(pageGroups.every((g) => g.page && getFeatureType(g.page) === "page")).toBe(true);
  });

  it("places children under their parentFeatureKey", () => {
    for (const group of groups) {
      if (group.id === OTHER_FEATURE_GROUP_ID) continue;
      for (const child of group.children) {
        expect(child.parentFeatureKey).toBe(group.id);
        expect(getFeatureType(child)).not.toBe("page");
      }
    }
  });

  it("includes every registered feature exactly once", () => {
    const seen = groups.flatMap((g) => [...(g.page ? [g.page.key] : []), ...g.children.map((c) => c.key)]);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.sort()).toEqual(FEATURE_REGISTRY.map((e) => e.key).sort());
  });

  it("routes unparented features to Other / Global Features", () => {
    const other = groups.find((g) => g.id === OTHER_FEATURE_GROUP_ID);
    const unparented = FEATURE_REGISTRY.filter(
      (e) =>
        getFeatureType(e) !== "page" &&
        (!e.parentFeatureKey ||
          !FEATURE_REGISTRY.some((p) => p.key === e.parentFeatureKey && getFeatureType(p) === "page")),
    );
    if (unparented.length === 0) {
      expect(other).toBeUndefined();
    } else {
      expect(other?.children.map((c) => c.key).sort()).toEqual(unparented.map((c) => c.key).sort());
    }
  });

  it("matches search against name, key and description", () => {
    const entry = FEATURE_REGISTRY[0];
    expect(featureMatchesQuery(entry, entry.name.slice(0, 4).toUpperCase())).toBe(true);
    expect(featureMatchesQuery(entry, entry.key)).toBe(true);
    expect(featureMatchesQuery(entry, "zzz-not-a-feature")).toBe(false);
    expect(featureMatchesQuery(entry, "   ")).toBe(true);
  });
});
