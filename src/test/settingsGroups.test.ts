import { describe, it, expect } from "vitest";
import { settingsGroupForParams } from "@/lib/settingsDeepLink";

const p = (s: string) => new URLSearchParams(s);
describe("settingsGroupForParams", () => {
  it("company and retirement deep links open Companies & Employment", () => {
    expect(settingsGroupForParams(p("company=abc&open=withholding"))).toBe("companies");
    expect(settingsGroupForParams(p("section=employer-match"))).toBe("companies");
    expect(settingsGroupForParams(p("section=companies&group=help"))).toBe("companies");
  });
  it("explicit group or landing", () => {
    expect(settingsGroupForParams(p("group=account"))).toBe("account");
    expect(settingsGroupForParams(p("group=bogus"))).toBeNull();
    expect(settingsGroupForParams(p(""))).toBeNull();
  });
});
