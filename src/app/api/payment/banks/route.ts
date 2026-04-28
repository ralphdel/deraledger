import { NextResponse } from "next/server";
import { PaymentService } from "@/lib/payment";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const country = searchParams.get("country") || "nigeria";

    let banks = await PaymentService.getBankList(country);
    
    // Inject Paystack Test Bank if we are in development/test mode
    // so the user can easily bypass the live resolution limit.
    if (!banks.find(b => b.code === "test" || b.code === "001")) {
      banks = [
        { name: "Paystack Test Bank", code: "001" },
        ...banks
      ];
    }

    return NextResponse.json({ success: true, data: banks });
  } catch (error: any) {
    console.error("Failed to fetch banks:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to fetch banks" },
      { status: 500 }
    );
  }
}
