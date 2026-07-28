"use client";

import { CheckCircle2, CircleAlert, Clock3, FileText } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SoloPlusBrowserCaseDto } from "@/lib/solo-plus/server/route-contracts";
import { cn } from "@/lib/utils";
import { ActivityProfileForm } from "./activity-profile-form";
import { getSoloPlusRequirementPresentation } from "@/lib/solo-plus/ui";

type RequirementsChecklistProps = {
  caseData: SoloPlusBrowserCaseDto;
  onCaseRefresh: () => Promise<void> | void;
};

function toneClasses(tone: "neutral" | "warning" | "success" | "danger") {
  switch (tone) {
    case "success":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "danger":
      return "border-red-200 bg-red-50 text-red-800";
    default:
      return "border-slate-200 bg-slate-50 text-slate-800";
  }
}

function RequirementIcon({
  tone,
  actionable,
}: {
  tone: "neutral" | "warning" | "success" | "danger";
  actionable: boolean;
}) {
  if (tone === "success") {
    return <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />;
  }

  if (tone === "danger" || actionable) {
    return <CircleAlert className="h-5 w-5 text-red-600" aria-hidden="true" />;
  }

  return <Clock3 className="h-5 w-5 text-slate-500" aria-hidden="true" />;
}

export function RequirementsChecklist({
  caseData,
  onCaseRefresh,
}: RequirementsChecklistProps) {
  if (caseData.requirements.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Verification requirements</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No requirements are available for this Solo Plus request yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Verification requirements</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {caseData.requirements.map((requirement) => {
          const presentation = getSoloPlusRequirementPresentation(
            requirement,
            caseData.actionRequired,
          );

          return (
            <section
              key={requirement.requirementCode}
              className="rounded-2xl border border-border bg-background p-4"
            >
              <div className="flex items-start gap-3">
                <RequirementIcon
                  tone={presentation.tone}
                  actionable={presentation.actionable}
                />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-foreground">
                      {presentation.label}
                    </h3>
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-2.5 py-1 text-xs font-medium",
                        toneClasses(presentation.tone),
                      )}
                    >
                      {presentation.stateLabel}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {presentation.description}
                  </p>

                  {requirement.evidenceSourceType ? (
                    <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1 text-xs text-muted-foreground">
                      <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                      Evidence source: {requirement.evidenceSourceType.replaceAll("_", " ")}
                    </div>
                  ) : null}

                  {presentation.usesStructuredForm ? (
                    <div className="rounded-2xl border border-border/80 bg-muted/40 p-4">
                      <p className="mb-4 text-sm text-muted-foreground">
                        Complete the structured activity profile below to keep this Solo Plus review moving.
                      </p>
                      <ActivityProfileForm
                        caseId={caseData.caseId}
                        onSubmitted={onCaseRefresh}
                        disabled={caseData.reviewState === "under_review" || caseData.caseStatus === "cancelled"}
                      />
                    </div>
                  ) : presentation.actionable ? (
                    <div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      Additional verification for this requirement will be handled through the existing verification process.
                      This controlled launch does not accept direct document uploads or pasted storage references.
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}
