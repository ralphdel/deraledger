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

    if (!/^\d{10}$/.test(accountNumber)) {
      return NextResponse.json(
        { success: false, error: "Account number must be exactly 10 digits." },
        { status: 400 }
      );
    }

    try {
      const resolution = await PaymentService.resolveAccountNumber(bankCode, accountNumber, "monnify");
      return NextResponse.json({ success: true, data: resolution });
    } catch (error: unknown) {
      const maskedAccount = `${accountNumber.slice(0, 2)}******${accountNumber.slice(-2)}`;
      console.warn("Monnify account verification failed:", {
        provider: "monnify",
        bankCode,
        accountNumber: maskedAccount,
        message: error instanceof Error ? error.message : "Unknown error",
      });
      return NextResponse.json(
        {
          success: false,
          error: "We could not verify this account. Please confirm the bank and account number.",
        },
        { status: 400 }
      );
    }
  } catch (error: unknown) {
    console.error("Failed to resolve Monnify account:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to resolve account. Please check the account number and try again." },
      { status: 500 }
    );
  }
}
