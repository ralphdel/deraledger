declare module "@paystack/inline-js" {
  type PaystackInlineCallbacks = {
    onSuccess?: (transaction: { reference?: string }) => void;
    onCancel?: () => void;
    onError?: (error: unknown) => void;
  };

  export default class PaystackInline {
    newTransaction(options: Record<string, unknown>): unknown;
    resumeTransaction(
      accessCode: string,
      callbacks?: PaystackInlineCallbacks,
    ): unknown;
  }
}
