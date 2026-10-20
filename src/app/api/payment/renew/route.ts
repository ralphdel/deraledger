import { POST as initializeRenewal } from "@/app/api/payment/renew-initialize/route";

// Deprecated compatibility endpoint. Keep one implementation of renewal
// initialization so this route cannot diverge into an unsafe payment purpose.
export async function POST(request: Request) {
  return initializeRenewal(request);
}
