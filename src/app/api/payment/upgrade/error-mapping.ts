type UpgradeInitializationErrorLike = {
  code?: unknown;
  message?: unknown;
};

export function mapUpgradeInitializationError(error: unknown) {
  const candidate =
    typeof error === "object" && error !== null
      ? (error as UpgradeInitializationErrorLike)
      : null;

  if (
    (candidate?.code === "SOLO_PLUS_PAYMENT_INIT_CONFLICT" ||
      candidate?.code === "SOLO_PLUS_PAYMENT_ALREADY_CONFIRMED" ||
      candidate?.code === "SOLO_PLUS_PAYMENT_INITIALIZATION_RECOVERY_REQUIRED" ||
      candidate?.code === "SOLO_PLUS_PAYMENT_ALREADY_COMPLETED" ||
      candidate?.code === "SOLO_PLUS_PAYMENT_RECOVERY_IN_PROGRESS" ||
      candidate?.code === "SOLO_PLUS_PAYMENT_RECOVERY_VERIFICATION_FAILED" ||
      candidate?.code === "SOLO_PLUS_PAYMENT_RECOVERY_NOT_ALLOWED" ||
      candidate?.code === "SOLO_PLUS_PAYMENT_RECOVERY_CONFLICT") &&
    typeof candidate.message === "string"
  ) {
    return {
      status:
        candidate?.code === "SOLO_PLUS_PAYMENT_RECOVERY_NOT_ALLOWED"
          ? 403
          : candidate?.code === "SOLO_PLUS_PAYMENT_RECOVERY_VERIFICATION_FAILED"
            ? 409
            : 409,
      error: candidate.message,
      code: String(candidate.code),
    };
  }

  return {
    status: 500,
    error: "Upgrade initialization failed unexpectedly.",
    code: "INTERNAL_ERROR",
  };
}
