import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OnboardingErrorBoundary } from "@/components/OnboardingErrorBoundary";

function Boom(): JSX.Element {
  throw new Error("kaboom");
}

describe("OnboardingErrorBoundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("renders children when no error (signup → onboarding first render does not blank)", () => {
    render(
      <OnboardingErrorBoundary>
        <div>onboarding-content</div>
      </OnboardingErrorBoundary>,
    );
    expect(screen.getByText("onboarding-content")).toBeInTheDocument();
  });

  it("renders a friendly fallback when a child throws, with Try again / Restart / Dashboard actions", () => {
    render(
      <OnboardingErrorBoundary>
        <Boom />
      </OnboardingErrorBoundary>,
    );
    expect(screen.getByText(/Something went wrong while loading onboarding/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /restart onboarding/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /go to dashboard/i })).toBeInTheDocument();
  });

  it("logs the error to console for debugging", () => {
    const spy = vi.spyOn(console, "error");
    render(
      <OnboardingErrorBoundary>
        <Boom />
      </OnboardingErrorBoundary>,
    );
    const onboardingLog = spy.mock.calls.find((args) => String(args[0]).includes("[Onboarding]"));
    expect(onboardingLog).toBeTruthy();
  });

  it("Try again clears the error and re-renders children", () => {
    let shouldThrow = true;
    function Conditional() {
      if (shouldThrow) throw new Error("boom");
      return <div>recovered</div>;
    }
    render(
      <OnboardingErrorBoundary>
        <Conditional />
      </OnboardingErrorBoundary>,
    );
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(screen.getByText("recovered")).toBeInTheDocument();
  });
});
