import { NextResponse } from "next/server";
import { PaymentService } from "@/lib/payment";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const bankCode = searchParams.get("bank_code");
    const accountNumber = searchParams.get("account_number");

    if (!bankCode || !accountNumber) {
      return NextResponse.json(
        { success: false, error: "Missing bank_code or account_number" },
        { status: 400 }
      );
    }

    // Bypass Paystack's strict test mode rate limits if using the standard test account
    if (accountNumber === "0000000000") {
      return NextResponse.json({
        success: true,
        data: {
          accountName: "Paystack Test Account",
          accountNumber: "0000000000",
          bankId: parseInt(bankCode) || 1,
        }
      });
    }

    let resolution;
    try {
      resolution = await PaymentService.resolveAccountNumber(bankCode, accountNumber);
    } catch (apiError: any) {
      // In development or test mode, Paystack's account resolution might fail because it can't reach real banks.
      // We mock the resolution to allow testing.
      if (process.env.NODE_ENV !== "production") {
        console.warn("Paystack account resolution failed, using mock data for development:", apiError.message);
        resolution = {
          accountName: "Test Merchant Account",
          accountNumber: accountNumber,
          bankId: parseInt(bankCode) || 1,
        };
      } else {
        throw apiError;
      }
    }
    
    return NextResponse.json({ success: true, data: resolution });
  } catch (error: any) {
    console.error("Failed to resolve account:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to resolve account. Please check the account number and try again." },
      { status: 500 }
    );
  }
}
