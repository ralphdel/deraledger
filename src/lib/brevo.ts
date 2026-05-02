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
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  const appUrl = configuredUrl || (process.env.NODE_ENV === "development" ? "http://localhost:3000" : "https://purpledger.vercel.app");
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

export async function sendPaymentReceiptEmail(
  toEmail: string,
  clientName: string,
  businessName: string,
  invoiceNumber: string,
  amountPaid: string,
  newOutstanding: string,
  payByDate: string | null,
  paymentUrl: string
) {
  const subject = `Payment Received - Invoice ${invoiceNumber}`;
  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9fafb; padding: 20px; border-radius: 8px;">
      <div style="background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); text-align: center;">
        <div style="background-color: #10B981; color: white; width: 60px; height: 60px; border-radius: 30px; display: flex; align-items: center; justify-content: center; font-size: 30px; margin: 0 auto 20px;">
          ✓
        </div>
        <h2 style="color: #065F46; margin-top: 0;">Payment Received!</h2>
        <p style="color: #4B5563; font-size: 16px; margin-bottom: 24px;">
          Hi ${clientName},
        </p>
        <p style="color: #4B5563; font-size: 16px; margin-bottom: 24px;">
          Thank you! <strong>${businessName}</strong> has successfully received your payment of <strong>${amountPaid}</strong> for Invoice ${invoiceNumber}.
        </p>
        
        <div style="background-color: #F3F4F6; padding: 16px; border-radius: 6px; margin-bottom: 24px; text-align: left;">
          <p style="margin: 4px 0; color: #374151;"><strong>Amount Paid Today:</strong> <span style="color: #10B981; font-weight: bold;">${amountPaid}</span></p>
          <p style="margin: 4px 0; color: #374151;"><strong>Remaining Balance:</strong> ${newOutstanding}</p>
          ${payByDate && parseFloat(newOutstanding.replace(/[^0-9.]/g, '')) > 0 ? `<p style="margin: 4px 0; color: #D97706;"><strong>Reminder:</strong> Please pay the remaining balance before ${payByDate} to avoid late charges.</p>` : ''}
        </div>

        ${parseFloat(newOutstanding.replace(/[^0-9.]/g, '')) > 0 ? `
          <a href="${paymentUrl}" style="display: inline-block; background-color: #4C1D95; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; margin-bottom: 24px;">
            Pay Remaining Balance
          </a>
        ` : `
          <div style="background-color: #ECFDF5; border: 1px solid #A7F3D0; color: #065F46; padding: 12px; border-radius: 6px; margin-bottom: 24px;">
            <strong>This invoice is now fully paid. Thank you!</strong>
          </div>
        `}
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

// ── v2.1 New Email Functions ──────────────────────────────────────────────────

/**
 * Welcome email sent after subscription payment is confirmed.
 * Contains a magic link to /onboarding/set-password.
 */
export async function sendOnboardingWelcomeEmail(
  toEmail: string,
  businessName: string,
  plan: "starter" | "individual" | "corporate",
  setPasswordLink: string,
  expiryDate?: string
) {
  const planLabel = plan === "starter" ? "Starter" : plan === "individual" ? "Individual" : "Corporate";
  const planPrice = plan === "starter" ? "Free" : plan === "individual" ? "₦5,000/month" : "₦20,000/month";
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  const appUrl = configuredUrl || (process.env.NODE_ENV === "development" ? "http://localhost:3000" : "https://purpledger.vercel.app");

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #111827; border: 1px solid #E5E7EB; border-radius: 8px; overflow: hidden;">
      <div style="background-color: #4C1D95; padding: 28px; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">Welcome to PurpLedger!</h1>
        <p style="color: #C4B5FD; margin: 8px 0 0 0; font-size: 14px;">Your ${planLabel} plan (${planPrice}) is now active${expiryDate ? ` until ${new Date(expiryDate).toLocaleDateString('en-NG')}` : ""}</p>
      </div>
      <div style="padding: 32px;">
        <p>Hello ${businessName},</p>
        <p>${plan === "starter" ? `Your <strong>PurpLedger ${planLabel} Plan</strong> is now active. Your account is ready.` : `Your payment for the <strong>PurpLedger ${planLabel} Plan</strong> has been confirmed. Your account is ready.`}</p>
        <p>Click the button below to set your password and access your dashboard.</p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${setPasswordLink}" style="background-color: #4C1D95; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; display: inline-block;">
            Set My Password &rarr;
          </a>
        </div>
        <div style="background-color: #FFF7ED; border: 1px solid #FED7AA; padding: 14px; border-radius: 6px; margin: 20px 0;">
          <p style="margin: 0; font-size: 13px; color: #9A3412;">
            <strong>Note:</strong> This link expires in 1 hour. If it expires, <a href="${appUrl}/onboarding/resend" style="color: #9A3412;">click here to request a new one</a>.
          </p>
        </div>
      </div>
      <div style="background-color: #F9FAFB; padding: 16px; text-align: center; border-top: 1px solid #E5E7EB;">
        <p style="margin: 0; font-size: 12px; color: #9CA3AF;">PurpLedger &mdash; Smart Invoicing &amp; Payment Tracking</p>
      </div>
    </div>
  `;

  return sendEmail({
    sender: { name: "PurpLedger", email: ADMIN_EMAIL },
    to: [{ email: toEmail }],
    subject: `Welcome to PurpLedger — set your password to get started`,
    htmlContent,
  });
}

/**
 * Reminder email for Record Invoices.
 * CRITICAL: Must NEVER contain a Pay Now button, payment link, or QR code.
 * The client is directed to contact the merchant directly.
 */
export async function sendRecordReminderEmail(
  toEmail: string,
  clientName: string,
  invoiceNumber: string,
  businessName: string,
  merchantEmail: string,
  merchantPhone: string | null,
  amountDue: string,
  dueDate: string,
  type: "standard" | "urgent" | "overdue"
) {
  const color =
    type === "overdue" ? "#DC2626" : type === "urgent" ? "#D97706" : "#4C1D95";
  const subject =
    type === "overdue"
      ? `OVERDUE: Invoice ${invoiceNumber} from ${businessName}`
      : type === "urgent"
      ? `Reminder: Invoice ${invoiceNumber} is due very soon`
      : `Reminder: Invoice ${invoiceNumber} from ${businessName}`;

  const urgencyText =
    type === "overdue"
      ? `<strong style="color: ${color};">This invoice is now overdue.</strong> `
      : type === "urgent"
      ? `<strong style="color: ${color};">This invoice is due very soon.</strong> `
      : "";

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #111827; border: 1px solid #E5E7EB; border-radius: 8px; overflow: hidden;">
      <div style="background-color: ${color}; padding: 20px; text-align: center;">
        <h2 style="color: white; margin: 0;">${businessName}</h2>
        <p style="color: rgba(255,255,255,0.85); margin: 4px 0 0 0; font-size: 14px;">Invoice Reminder</p>
      </div>
      <div style="padding: 30px;">
        <p>Hello ${clientName},</p>
        <p style="font-size: 15px; line-height: 1.6;">
          ${urgencyText}You have an outstanding invoice from <strong>${businessName}</strong>.
        </p>
        <div style="background-color: #F9FAFB; border: 1px solid #E5E7EB; padding: 16px; border-radius: 6px; margin: 20px 0;">
          <p style="margin: 4px 0;"><strong>Invoice:</strong> ${invoiceNumber}</p>
          <p style="margin: 4px 0;"><strong>Amount Due:</strong> <span style="color: ${color}; font-weight: bold;">${amountDue}</span></p>
          <p style="margin: 4px 0;"><strong>Due Date:</strong> ${dueDate}</p>
        </div>
        <div style="background-color: #F3F4F6; padding: 16px; border-radius: 6px; margin: 20px 0;">
          <p style="margin: 0 0 8px 0; font-weight: bold;">To arrange payment, contact ${businessName}:</p>
          <p style="margin: 4px 0;">📧 <a href="mailto:${merchantEmail}" style="color: #4C1D95;">${merchantEmail}</a></p>
          ${merchantPhone ? `<p style="margin: 4px 0;">📞 ${merchantPhone}</p>` : ""}
        </div>
        <p style="font-size: 14px; color: #4B5563;">Thank you for your prompt attention.</p>
      </div>
      <div style="background-color: #F9FAFB; padding: 16px; text-align: center; border-top: 1px solid #E5E7EB;">
        <p style="margin: 0; font-size: 12px; color: #9CA3AF;">PurpLedger &mdash; Smart Invoicing &amp; Payment Tracking</p>
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

/**
 * Sends a warning email when a subscription is nearing expiry (e.g. 7 days or 3 days).
 */
export async function sendSubscriptionExpiringEmail(
  toEmail: string,
  businessName: string,
  planType: string,
  expiryDate: string,
  daysRemaining: number
) {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  const appUrl = configuredUrl || (process.env.NODE_ENV === "development" ? "http://localhost:3000" : "https://purpledger.vercel.app");
  const settingsLink = `${appUrl}/settings/billing`;
  const amount = planType === "individual" ? "₦5,000" : "₦20,000";
  const formattedDate = new Date(expiryDate).toLocaleDateString("en-NG", { year: 'numeric', month: 'long', day: 'numeric' });
  const isUrgent = daysRemaining <= 3;

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #111827; border: 1px solid #E5E7EB; border-radius: 8px; overflow: hidden;">
      <div style="background-color: ${isUrgent ? '#D97706' : '#4C1D95'}; padding: 20px; text-align: center;">
        <h2 style="color: white; margin: 0;">${isUrgent ? 'Urgent: Subscription Expiring Soon' : 'Subscription Expiring Soon'}</h2>
      </div>
      <div style="padding: 30px;">
        <p>Hello ${businessName},</p>
        <p style="font-size: 15px; line-height: 1.6;">
          This is a reminder that your PurpLedger <strong>${planType.toUpperCase()}</strong> plan will expire in <strong>${daysRemaining} days</strong> (on ${formattedDate}).
        </p>
        <div style="background-color: #F9FAFB; border: 1px solid #E5E7EB; padding: 16px; border-radius: 6px; margin: 20px 0;">
          <p style="margin: 0; color: #374151;">To ensure uninterrupted access to PurpLedger's invoicing and collection tools, please renew your subscription (${amount}) before it expires.</p>
        </div>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${settingsLink}" style="background-color: #4C1D95; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; display: inline-block;">
            Renew Now
          </a>
        </div>
      </div>
      <div style="background-color: #F9FAFB; padding: 16px; text-align: center; border-top: 1px solid #E5E7EB;">
        <p style="margin: 0; font-size: 12px; color: #9CA3AF;">PurpLedger &mdash; Smart Invoicing &amp; Payment Tracking</p>
      </div>
    </div>
  `;

  return sendEmail({
    sender: { name: "PurpLedger Subscriptions", email: ADMIN_EMAIL },
    to: [{ email: toEmail }],
    subject: `Action Required: Your PurpLedger plan expires in ${daysRemaining} days`,
    htmlContent,
  });
}

/**
 * Sends a confirmation email after a successful renewal.
 */
export async function sendSubscriptionRenewalEmail(
  toEmail: string,
  businessName: string,
  planType: string,
  amountPaid: number,
  periodStart: string,
  periodEnd: string,
  reference: string
) {
  const formattedStart = new Date(periodStart).toLocaleDateString("en-NG", { year: 'numeric', month: 'long', day: 'numeric' });
  const formattedEnd = new Date(periodEnd).toLocaleDateString("en-NG", { year: 'numeric', month: 'long', day: 'numeric' });

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #111827; border: 1px solid #E5E7EB; border-radius: 8px; overflow: hidden;">
      <div style="background-color: #10B981; padding: 20px; text-align: center;">
        <h2 style="color: white; margin: 0;">Subscription Renewed</h2>
      </div>
      <div style="padding: 30px;">
        <p>Hello ${businessName},</p>
        <p style="font-size: 15px; line-height: 1.6;">
          Thank you! Your PurpLedger <strong>${planType.toUpperCase()}</strong> plan has been successfully renewed.
        </p>
        <div style="background-color: #F9FAFB; border: 1px solid #E5E7EB; padding: 16px; border-radius: 6px; margin: 20px 0;">
          <p style="margin: 4px 0; color: #374151;"><strong>Amount Paid:</strong> ₦${amountPaid.toLocaleString('en-US')}</p>
          <p style="margin: 4px 0; color: #374151;"><strong>New Period:</strong> ${formattedStart} to ${formattedEnd}</p>
          <p style="margin: 4px 0; color: #374151;"><strong>Reference:</strong> ${reference}</p>
        </div>
        <p style="font-size: 14px; color: #4B5563;">Thank you for trusting PurpLedger with your collections.</p>
      </div>
      <div style="background-color: #F9FAFB; padding: 16px; text-align: center; border-top: 1px solid #E5E7EB;">
        <p style="margin: 0; font-size: 12px; color: #9CA3AF;">PurpLedger &mdash; Smart Invoicing &amp; Payment Tracking</p>
      </div>
    </div>
  `;

  return sendEmail({
    sender: { name: "PurpLedger Subscriptions", email: ADMIN_EMAIL },
    to: [{ email: toEmail }],
    subject: `Receipt: PurpLedger Subscription Renewed`,
    htmlContent,
  });
}

/**
 * Sends an email on Day 0 when the subscription has expired.
 */
export async function sendSubscriptionExpiredEmail(
  toEmail: string,
  businessName: string,
  planType: string
) {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  const appUrl = configuredUrl || (process.env.NODE_ENV === "development" ? "http://localhost:3000" : "https://purpledger.vercel.app");
  const settingsLink = `${appUrl}/settings/billing`;
  const amount = planType === "individual" ? "₦5,000" : "₦20,000";

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #111827; border: 1px solid #E5E7EB; border-radius: 8px; overflow: hidden;">
      <div style="background-color: #DC2626; padding: 20px; text-align: center;">
        <h2 style="color: white; margin: 0;">Subscription Expired</h2>
      </div>
      <div style="padding: 30px;">
        <p>Hello ${businessName},</p>
        <p style="font-size: 15px; line-height: 1.6;">
          Your PurpLedger <strong>${planType.toUpperCase()}</strong> plan has expired today.
        </p>
        <div style="background-color: #FEF2F2; border: 1px solid #FECACA; padding: 16px; border-radius: 6px; margin: 20px 0; color: #991B1B;">
          <p style="margin: 0 0 8px 0; font-weight: bold;">Features affected:</p>
          <ul style="margin: 0; padding-left: 20px; font-size: 14px;">
            <li>Payment links are now inactive.</li>
            <li>PurpBot AI is disabled.</li>
            <li>Team members cannot access the dashboard.</li>
          </ul>
        </div>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${settingsLink}" style="background-color: #4C1D95; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; display: inline-block;">
            Renew Now &mdash; Restore Access
          </a>
        </div>
      </div>
      <div style="background-color: #F9FAFB; padding: 16px; text-align: center; border-top: 1px solid #E5E7EB;">
        <p style="margin: 0; font-size: 12px; color: #9CA3AF;">PurpLedger &mdash; Smart Invoicing &amp; Payment Tracking</p>
      </div>
    </div>
  `;

  return sendEmail({
    sender: { name: "PurpLedger Subscriptions", email: ADMIN_EMAIL },
    to: [{ email: toEmail }],
    subject: `Notice: Your PurpLedger subscription has expired`,
    htmlContent,
  });
}

/**
 * Sends a daily grace period warning.
 */
export async function sendSubscriptionGraceEmail(
  toEmail: string,
  businessName: string,
  daysRemainingBeforeLock: number
) {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  const appUrl = configuredUrl || (process.env.NODE_ENV === "development" ? "http://localhost:3000" : "https://purpledger.vercel.app");
  const settingsLink = `${appUrl}/settings/billing`;

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #111827; border: 1px solid #E5E7EB; border-radius: 8px; overflow: hidden;">
      <div style="background-color: #B45309; padding: 20px; text-align: center;">
        <h2 style="color: white; margin: 0;">Account Lock Warning</h2>
      </div>
      <div style="padding: 30px;">
        <p>Hello ${businessName},</p>
        <p style="font-size: 15px; line-height: 1.6;">
          Your subscription is currently in a grace period. In <strong>${daysRemainingBeforeLock} days</strong>, your account will be fully locked if not renewed.
        </p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${settingsLink}" style="background-color: #4C1D95; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; display: inline-block;">
            Renew Now
          </a>
        </div>
      </div>
      <div style="background-color: #F9FAFB; padding: 16px; text-align: center; border-top: 1px solid #E5E7EB;">
        <p style="margin: 0; font-size: 12px; color: #9CA3AF;">PurpLedger &mdash; Smart Invoicing &amp; Payment Tracking</p>
      </div>
    </div>
  `;

  return sendEmail({
    sender: { name: "PurpLedger Subscriptions", email: ADMIN_EMAIL },
    to: [{ email: toEmail }],
    subject: `Grace Period: ${daysRemainingBeforeLock} days until account lock`,
    htmlContent,
  });
}

