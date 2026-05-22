import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class OnboardingErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[Onboarding] render error", error, info);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  private handleRestart = () => {
    try {
      sessionStorage.removeItem("paycheckmd-onboarding-step");
      sessionStorage.removeItem("paycheckmd-onboarding-start");
    } catch {
      // ignore storage errors
    }
    window.location.assign("/onboarding");
  };

  private handleDashboard = () => {
    window.location.assign("/");
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen bg-background px-4 py-10">
        <Card className="mx-auto w-full max-w-md">
          <CardContent className="space-y-4 p-6">
            <h1 className="text-xl font-semibold text-foreground">Something went wrong while loading onboarding.</h1>
            <p className="text-sm text-muted-foreground">
              {this.state.error?.message || "An unexpected error occurred."}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={this.handleRetry}>Try again</Button>
              <Button type="button" variant="outline" onClick={this.handleRestart}>Restart onboarding</Button>
              <Button type="button" variant="ghost" onClick={this.handleDashboard}>Go to dashboard</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
}

export default OnboardingErrorBoundary;
