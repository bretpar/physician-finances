import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PLAN_OPTIONS, type SelectablePlan } from "@/lib/planSelection";

interface PlanSelectionStepProps {
  selected: SelectablePlan | null;
  onSelect: (plan: SelectablePlan) => void;
  disabled?: boolean;
}

/**
 * Mobile-first Free vs Premium chooser. Cards stack vertically on phones and
 * may sit side by side from `sm` up. No pricing and no comparison grid — the
 * selected plan writes to the canonical account role.
 */
export function PlanSelectionStep({ selected, onSelect, disabled }: PlanSelectionStepProps) {
  return (
    <div className="space-y-4" data-testid="onboarding-step-plan">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Choose your plan</h1>
        <p className="mt-1 text-sm text-muted-foreground">Pick the plan that fits how you want to use PaycheckMD.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {PLAN_OPTIONS.map((option) => {
          const isSelected = selected === option.plan;
          return (
            <button
              key={option.plan}
              type="button"
              disabled={disabled}
              aria-pressed={isSelected}
              data-testid={`onboarding-plan-option-${option.plan}`}
              data-selected={isSelected ? "true" : "false"}
              onClick={() => onSelect(option.plan)}
              className={cn(
                "w-full min-w-0 rounded-xl border p-4 text-left transition-colors disabled:opacity-60",
                isSelected ? "border-primary border-2 bg-primary/5" : "border-border bg-card hover:bg-muted/40",
              )}
            >
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                    isSelected ? "border-primary bg-primary text-primary-foreground" : "border-border",
                  )}
                >
                  {isSelected && <Check className="h-3 w-3" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-semibold text-card-foreground">{option.title}</span>
                    {option.badge && (
                      <Badge variant="secondary" className="text-[10px] font-medium">
                        {option.badge}
                      </Badge>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{option.subtitle}</span>
                  <span className="mt-3 block space-y-1.5">
                    {option.benefits.map((benefit) => (
                      <span key={benefit} className="flex items-start gap-2 text-xs text-muted-foreground">
                        <Check className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                        <span className="min-w-0 break-words">{benefit}</span>
                      </span>
                    ))}
                  </span>
                  <span className="mt-3 block text-xs font-medium text-primary">{option.chooseLabel}</span>
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">You can change your plan later in Settings.</p>
    </div>
  );
}
