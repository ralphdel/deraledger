// src/lib/brevo.ts

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";
const ADMIN_EMAIL = "ralphdel14@yahoo.com"; // Verified sender email on Brevo

async function sendEmail(payload: any) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.warn("BREVO_API_KEY is not set. Email not sent.");
    return { success: false, error: "API Key missing" };
  }

  try {
    const response = await fetch(BREVO_API_URL, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const err = await response.json();
      console.error("Brevo Error:", err);
      return { success: false, error: err.message };
    }

    return { success: true };
  } catch (error: any) {
    console.error("Brevo Request Failed:", error);
    return { success: false, error: error.message };
  }
}

export async function sendTeamInviteEmail(
  toEmail: string,
  role: string,
  workspaceCode: string,
  businessName: string
) {
  // Use absolute URL for the login link
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://purpledger.vercel.app";
  const loginLink = `${appUrl}/login`;

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #111827;">
      <h2 style="color: #4C1D95;">You've been invited to PurpLedger!</h2>
      <p>Hello,</p>
      <p>You have been invited to join <strong>${businessName}</strong> as a <strong>${role.toUpperCase()}</strong> on PurpLedger.</p>
      
      <div style="background-color: #F3F4F6; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 0; font-size: 14px; color: #4B5563;">Your Workspace Code:</p>
        <p style="margin: 5px 0 0 0; font-size: 24px; font-weight: bold; letter-spacing: 2px; color: #111827;">
          ${workspaceCode}
        </p>
      </div>

      <p><strong>To accept this invitation:</strong></p>
      <ol>
        <li>Go to the <a href="${loginLink}" style="color: #4C1D95; font-weight: bold;">PurpLedger Login Page</a></li>
        <li>Enter your email: <strong>${toEmail}</strong></li>
        <li>Enter the Workspace Code above</li>
        <li>Create your password (if logging in for the first time) or use your existing password.</li>
      </ol>
      
      <p style="margin-top: 30px; font-size: 12px; color: #6B7280;">
        If you did not expect this invitation, you can safely ignore this email.
      </p>
    </div>
  `;

  return sendEmail({
    sender: { name: "PurpLedger Admin", email: ADMIN_EMAIL },
    to: [{ email: toEmail }],
    subject: `Invitation to join ${businessName} on PurpLedger`,
    htmlContent,
  });
}

export async function sendInvoiceReminderEmail(
  toEmail: string,
  clientName: string,
  invoiceNumber: string,
  businessName: string,
  amountDue: string,
  dueDate: string,
  type: "standard" | "urgent" | "overdue",
  payLink: string
) {
  let subject = "";
  let greeting = `Hello ${clientName},`;
  let message = "";
  let color = "#4C1D95"; // Default Purple

  if (type === "standard") {
    subject = `Reminder: Invoice ${invoiceNumber} from ${businessName}`;
    message = `This is a friendly reminder that invoice <strong>${invoiceNumber}</strong> for <strong>${amountDue}</strong> is due on <strong>${dueDate}</strong>.`;
  } else if (type === "urgent") {
    subject = `URGENT: Invoice ${invoiceNumber} is due very soon`;
    message = `Please be advised that your invoice <strong>${invoiceNumber}</strong> for <strong>${amountDue}</strong> is due in less than 3 days on <strong>${dueDate}</strong>.`;
    color = "#D97706"; // Amber
  } else if (type === "overdue") {
    subject = `OVERDUE: Invoice ${invoiceNumber} requires immediate payment`;
    message = `Your invoice <strong>${invoiceNumber}</strong> for <strong>${amountDue}</strong> is currently <strong>OVERDUE</strong>. It was due on <strong>${dueDate}</strong>. Please arrange for payment immediately.`;
    color = "#DC2626"; // Red
  }

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #111827; border: 1px solid #E5E7EB; border-radius: 8px; overflow: hidden;">
      <div style="background-color: ${color}; padding: 20px; text-align: center;">
        <h2 style="color: white; margin: 0;">${businessName}</h2>
      </div>
      
      <div style="padding: 30px;">
        <p>${greeting}</p>
        <p style="font-size: 16px; line-height: 1.5;">${message}</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${payLink}" style="background-color: ${color}; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
            View and Pay Invoice
          </a>
        </div>
        
        <p style="font-size: 14px; color: #4B5563;">Thank you for your prompt payment.</p>
        <p style="font-size: 14px; color: #4B5563;">- The team at ${businessName}</p>
      </div>
    </div>
  `;

  return sendEmail({
    sender: { name: businessName, email: ADMIN_EMAIL },
    to: [{ email: toEmail }],
    subject,
    htmlContent,
  });
}
