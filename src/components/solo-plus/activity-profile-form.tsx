"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type ActivityProfileFormProps = {
  caseId: string;
  disabled?: boolean;
  onSubmitted: () => Promise<void> | void;
};

type FormState = {
  businessActivityType: string;
  expectedMonthlyTransactionValue: string;
  expectedTransactionCount: string;
  typicalCustomerType: string;
  reasonForHigherCollectionNeed: string;
  expectedSettlementBehaviour: string;
};

type FieldErrors = Partial<Record<keyof FormState, string>>;

const INITIAL_STATE: FormState = {
  businessActivityType: "",
  expectedMonthlyTransactionValue: "",
  expectedTransactionCount: "",
  typicalCustomerType: "",
  reasonForHigherCollectionNeed: "",
  expectedSettlementBehaviour: "",
};

function validateForm(state: FormState): FieldErrors {
  const errors: FieldErrors = {};

  if (state.businessActivityType.trim() === "") {
    errors.businessActivityType = "Describe your business activity.";
  }
  if (state.expectedMonthlyTransactionValue.trim() === "") {
    errors.expectedMonthlyTransactionValue = "Enter the expected monthly transaction value.";
  }
  if (state.expectedTransactionCount.trim() === "") {
    errors.expectedTransactionCount = "Enter the expected transaction count.";
  } else if (!/^\d+$/.test(state.expectedTransactionCount.trim())) {
    errors.expectedTransactionCount = "Use a whole number.";
  }
  if (state.typicalCustomerType.trim() === "") {
    errors.typicalCustomerType = "Describe your typical customers.";
  }
  if (state.reasonForHigherCollectionNeed.trim() === "") {
    errors.reasonForHigherCollectionNeed = "Explain why you need the higher collection capacity.";
  }
  if (state.expectedSettlementBehaviour.trim() === "") {
    errors.expectedSettlementBehaviour = "Describe how you expect settlement to work.";
  }

  return errors;
}

function mapErrorMessage(code: string | null): string {
  switch (code) {
    case "VERSION_CONFLICT":
    case "STATE_CONFLICT":
    case "PREREQUISITE_CONFLICT":
      return "This case changed while you were editing. Refresh and try again.";
    case "NOT_FOUND":
      return "This Solo Plus case is no longer available.";
    case "UNAUTHORIZED":
      return "Sign in again to continue this Solo Plus review.";
    default:
      return "We could not save the activity profile right now.";
  }
}

export function ActivityProfileForm({
  caseId,
  disabled = false,
  onSubmitted,
}: ActivityProfileFormProps) {
  const [state, setState] = useState<FormState>(INITIAL_STATE);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const canSubmit = useMemo(() => !disabled && !submitting, [disabled, submitting]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSubmitted(false);

    const nextErrors = validateForm(state);
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/solo-plus/case/requirements/evidence", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          caseId,
          activityProfile: {
            businessActivityType: state.businessActivityType.trim(),
            expectedMonthlyTransactionValue: state.expectedMonthlyTransactionValue.trim(),
            expectedTransactionCount: Number(state.expectedTransactionCount.trim()),
            typicalCustomerType: state.typicalCustomerType.trim(),
            reasonForHigherCollectionNeed: state.reasonForHigherCollectionNeed.trim(),
            expectedSettlementBehaviour: state.expectedSettlementBehaviour.trim(),
          },
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        code?: string;
      };

      if (!response.ok) {
        setFormError(mapErrorMessage(typeof payload.code === "string" ? payload.code : null));
        if (
          payload.code === "VERSION_CONFLICT" ||
          payload.code === "STATE_CONFLICT" ||
          payload.code === "PREREQUISITE_CONFLICT"
        ) {
          await onSubmitted();
        }
        return;
      }

      setState(INITIAL_STATE);
      setFieldErrors({});
      setSubmitted(true);
      await onSubmitted();
    } catch {
      setFormError("We could not save the activity profile right now.");
    } finally {
      setSubmitting(false);
    }
  }

  function setValue<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((current) => ({
      ...current,
      [key]: value,
    }));
    setFieldErrors((current) => ({
      ...current,
      [key]: undefined,
    }));
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <Label htmlFor="solo-plus-activity-type">Business activity</Label>
        <Input
          id="solo-plus-activity-type"
          value={state.businessActivityType}
          onChange={(event) => setValue("businessActivityType", event.target.value)}
          aria-invalid={fieldErrors.businessActivityType ? "true" : "false"}
          aria-describedby={fieldErrors.businessActivityType ? "solo-plus-activity-type-error" : undefined}
          placeholder="For example: wholesale distribution"
          disabled={!canSubmit}
        />
        {fieldErrors.businessActivityType ? (
          <p id="solo-plus-activity-type-error" className="text-sm text-red-600">
            {fieldErrors.businessActivityType}
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="solo-plus-monthly-value">Expected monthly transaction value</Label>
          <Input
            id="solo-plus-monthly-value"
            value={state.expectedMonthlyTransactionValue}
            onChange={(event) => setValue("expectedMonthlyTransactionValue", event.target.value)}
            aria-invalid={fieldErrors.expectedMonthlyTransactionValue ? "true" : "false"}
            aria-describedby={fieldErrors.expectedMonthlyTransactionValue ? "solo-plus-monthly-value-error" : undefined}
            placeholder="For example: NGN 12,000,000"
            disabled={!canSubmit}
          />
          {fieldErrors.expectedMonthlyTransactionValue ? (
            <p id="solo-plus-monthly-value-error" className="text-sm text-red-600">
              {fieldErrors.expectedMonthlyTransactionValue}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="solo-plus-transaction-count">Expected monthly transaction count</Label>
          <Input
            id="solo-plus-transaction-count"
            inputMode="numeric"
            value={state.expectedTransactionCount}
            onChange={(event) => setValue("expectedTransactionCount", event.target.value)}
            aria-invalid={fieldErrors.expectedTransactionCount ? "true" : "false"}
            aria-describedby={fieldErrors.expectedTransactionCount ? "solo-plus-transaction-count-error" : undefined}
            placeholder="For example: 120"
            disabled={!canSubmit}
          />
          {fieldErrors.expectedTransactionCount ? (
            <p id="solo-plus-transaction-count-error" className="text-sm text-red-600">
              {fieldErrors.expectedTransactionCount}
            </p>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="solo-plus-customer-type">Typical customer type</Label>
        <Input
          id="solo-plus-customer-type"
          value={state.typicalCustomerType}
          onChange={(event) => setValue("typicalCustomerType", event.target.value)}
          aria-invalid={fieldErrors.typicalCustomerType ? "true" : "false"}
          aria-describedby={fieldErrors.typicalCustomerType ? "solo-plus-customer-type-error" : undefined}
          placeholder="For example: repeat retail merchants"
          disabled={!canSubmit}
        />
        {fieldErrors.typicalCustomerType ? (
          <p id="solo-plus-customer-type-error" className="text-sm text-red-600">
            {fieldErrors.typicalCustomerType}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="solo-plus-collection-need">Why do you need the higher collection capacity?</Label>
        <Textarea
          id="solo-plus-collection-need"
          value={state.reasonForHigherCollectionNeed}
          onChange={(event) => setValue("reasonForHigherCollectionNeed", event.target.value)}
          aria-invalid={fieldErrors.reasonForHigherCollectionNeed ? "true" : "false"}
          aria-describedby={fieldErrors.reasonForHigherCollectionNeed ? "solo-plus-collection-need-error" : undefined}
          placeholder="Share the type of activity or customer demand driving this request."
          disabled={!canSubmit}
        />
        {fieldErrors.reasonForHigherCollectionNeed ? (
          <p id="solo-plus-collection-need-error" className="text-sm text-red-600">
            {fieldErrors.reasonForHigherCollectionNeed}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="solo-plus-settlement-behaviour">Expected settlement behaviour</Label>
        <Textarea
          id="solo-plus-settlement-behaviour"
          value={state.expectedSettlementBehaviour}
          onChange={(event) => setValue("expectedSettlementBehaviour", event.target.value)}
          aria-invalid={fieldErrors.expectedSettlementBehaviour ? "true" : "false"}
          aria-describedby={fieldErrors.expectedSettlementBehaviour ? "solo-plus-settlement-behaviour-error" : undefined}
          placeholder="Describe how customers pay you and how you expect settlements to move."
          disabled={!canSubmit}
        />
        {fieldErrors.expectedSettlementBehaviour ? (
          <p id="solo-plus-settlement-behaviour-error" className="text-sm text-red-600">
            {fieldErrors.expectedSettlementBehaviour}
          </p>
        ) : null}
      </div>

      {formError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {formError}
        </div>
      ) : null}

      {submitted ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          Activity profile submitted. We refreshed the latest Solo Plus status for you.
        </div>
      ) : null}

      <Button type="submit" disabled={!canSubmit}>
        {submitting ? "Submitting activity profile..." : "Submit activity profile"}
      </Button>
    </form>
  );
}
