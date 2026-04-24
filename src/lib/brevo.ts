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
  businessName: string,
  tempPassword: string
) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://purpledger.vercel.app";
  const loginLink = `${appUrl}/login`;

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #111827; border: 1px solid #E5E7EB; border-radius: 8px; overflow: hidden;">
      <div style="background-color: #4C1D95; padding: 24px; text-align: center;">
        <h2 style="color: white; margin: 0; font-size: 22px;">You've been invited to PurpLedger!</h2>
      </div>
      <div style="padding: 30px;">
        <p>Hello,</p>
        <p>You have been invited to join <strong>${businessName}</strong> as a <strong>${role.toUpperCase()}</strong>.</p>

        <div style="background-color: #F3F4F6; padding: 16px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 0 0 8px 0; font-size: 13px; color: #6B7280; text-transform: uppercase; letter-spacing: 1px;">Your Business ID</p>
          <p style="margin: 0; font-size: 22px; font-weight: bold; letter-spacing: 3px; color: #111827; font-family: monospace;">${workspaceCode}</p>
        </div>

        <div style="background-color: #FFF7ED; border: 1px solid #FED7AA; padding: 16px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 0 0 8px 0; font-size: 13px; color: #9A3412; text-transform: uppercase; letter-spacing: 1px;">Temporary Password (One-Time Use)</p>
          <p style="margin: 0; font-size: 20px; font-weight: bold; color: #7C2D12; font-family: monospace; letter-spacing: 2px;">${tempPassword}</p>
          <p style="margin: 8px 0 0 0; font-size: 12px; color: #9A3412;">You will be asked to create a new password after your first login.</p>
        </div>

        <div style="background-color: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 8px; padding: 20px; margin: 20px 0;">
          <p style="margin: 0 0 12px 0; font-weight: bold; color: #166534;">To accept this invitation:</p>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 6px 0; color: #166534; vertical-align: top; width: 24px; font-weight: bold;">1.</td><td style="padding: 6px 0;">Go to the <a href="${loginLink}" style="color: #4C1D95; font-weight: bold;">PurpLedger Login Page</a></td></tr>
            <tr><td style="padding: 6px 0; color: #166534; vertical-align: top; font-weight: bold;">2.</td><td style="padding: 6px 0;">Enter your email: <strong>${toEmail}</strong></td></tr>
            <tr><td style="padding: 6px 0; color: #166534; vertical-align: top; font-weight: bold;">3.</td><td style="padding: 6px 0;">Enter the temporary password above</td></tr>
            <tr><td style="padding: 6px 0; color: #166534; vertical-align: top; font-weight: bold;">4.</td><td style="padding: 6px 0;">Enter the Business ID: <strong>${workspaceCode}</strong></td></tr>
            <tr><td style="padding: 6px 0; color: #166534; vertical-align: top; font-weight: bold;">5.</td><td style="padding: 6px 0;">You will be redirected to set a permanent password</td></tr>
          </table>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${loginLink}" style="background-color: #4C1D95; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; display: inline-block;">
            Accept Invitation &rarr;
          </a>
        </div>

        <p style="margin-top: 20px; font-size: 12px; color: #6B7280;">
          If you did not expect this invitation, you can safely ignore this email.
        </p>
      </div>
      <div style="background-color: #F9FAFB; padding: 16px; text-align: center; border-top: 1px solid #E5E7EB;">
        <p style="margin: 0; font-size: 12px; color: #9CA3AF;">PurpLedger &mdash; Smart Invoicing & Payment Tracking</p>
      </div>
    </div>
  `;

  const textContent = `You've been invited to join ${businessName} on PurpLedger!\n\nRole: ${role.toUpperCase()}\nBusiness ID: ${workspaceCode}\nTemporary Password: ${tempPassword}\nYour Email: ${toEmail}\n\nSteps:\n1. Go to ${loginLink}\n2. Enter your email: ${toEmail}\n3. Enter the temporary password above\n4. Enter Business ID: ${workspaceCode}\n5. You'll be redirected to set a permanent password\n\nIf you did not expect this, ignore this email.`;

  return sendEmail({
    sender: { name: "PurpLedger", email: ADMIN_EMAIL },
    to: [{ email: toEmail }],
    subject: `You've been invited to join ${businessName} on PurpLedger`,
    htmlContent,
    textContent,
  });
}

export async function sendPasswordResetEmail(toEmail: string, resetLink: string) {
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #111827; border: 1px solid #E5E7EB; border-radius: 8px; overflow: hidden;">
      <div style="background-color: #4C1D95; padding: 24px; text-align: center;">
        <h2 style="color: white; margin: 0;">Reset Your Password</h2>
      </div>
      <div style="padding: 30px;">
        <p>We received a request to reset your PurpLedger password.</p>
        <p>Click the button below to create a new password. This link expires in 1 hour.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetLink}" style="background-color: #4C1D95; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; display: inline-block;">
            Reset My Password
          </a>
        </div>
        <p style="font-size: 13px; color: #6B7280;">If you did not request a password reset, you can safely ignore this email. Your password will not be changed.</p>
        <p style="font-size: 12px; color: #9CA3AF; margin-top: 20px; word-break: break-all;">Or copy this link: ${resetLink}</p>
      </div>
    </div>
  `;

  return sendEmail({
    sender: { name: "PurpLedger", email: ADMIN_EMAIL },
    to: [{ email: toEmail }],
    subject: "Reset your PurpLedger password",
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

export async function sendInvoiceEmail(
  toEmail: string,
  clientName: string,
  businessName: string,
  invoiceNumber: string,
  grandTotal: string,
  amountPaid: string,
  outstandingBalance: string,
  payByDate: string,
  paymentUrl: string
) {
  const subject = `Invoice ${invoiceNumber} from ${businessName}`;
  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9fafb; padding: 20px; border-radius: 8px;">
      <div style="background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); text-align: center;">
        <h2 style="color: #4C1D95; margin-top: 0;">New Invoice Available</h2>
        <p style="color: #4B5563; font-size: 16px; margin-bottom: 24px;">
          Hi ${clientName},
        </p>
        <p style="color: #4B5563; font-size: 16px; margin-bottom: 24px;">
          You have a new invoice from <strong>${businessName}</strong>.
        </p>
        
        <div style="background-color: #F3F4F6; padding: 16px; border-radius: 6px; margin-bottom: 24px; text-align: left;">
          <p style="margin: 4px 0; color: #374151;"><strong>Invoice Number:</strong> ${invoiceNumber}</p>
          <p style="margin: 4px 0; color: #374151;"><strong>Grand Total:</strong> ${grandTotal}</p>
          <p style="margin: 4px 0; color: #374151;"><strong>Amount Paid:</strong> ${amountPaid}</p>
          <p style="margin: 4px 0; color: #374151;"><strong>Outstanding Balance:</strong> <span style="color: #D97706; font-weight: bold;">${outstandingBalance}</span></p>
          ${payByDate ? `<p style="margin: 4px 0; color: #374151;"><strong>Pay-By Date:</strong> ${payByDate}</p>` : ''}
        </div>

        <a href="${paymentUrl}" style="display: inline-block; background-color: #4C1D95; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; margin-bottom: 24px;">
          Pay Invoice Now
        </a>

        <p style="font-size: 14px; color: #6B7280; margin-top: 24px;">
          If the button above doesn't work, copy and paste this URL into your browser:<br>
          <a href="${paymentUrl}" style="color: #4C1D95; word-break: break-all;">${paymentUrl}</a>
        </p>
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

