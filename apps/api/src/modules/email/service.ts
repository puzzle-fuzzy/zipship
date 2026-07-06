import nodemailer from "nodemailer";
import { config } from "@zipship/config";

export interface EmailServiceOptions {
  /** Base URL of the console app, used to build invitation links */
  appBaseUrl: string;
}

function isSmtpConfigured(): boolean {
  return !!(config.smtp.host && config.smtp.user && config.smtp.pass);
}

/**
 * Email service for ZipShip.
 *
 * - If SMTP env vars are configured (`ZIPSHIP_SMTP_HOST`/`USER`/`PASS`),
 *   sends real emails via nodemailer.
 * - Otherwise logs to console (development mode).
 */
export class EmailService {
  private readonly appBaseUrl: string;
  private transporter: nodemailer.Transporter | null = null;

  constructor(options: EmailServiceOptions) {
    this.appBaseUrl = options.appBaseUrl.replace(/\/$/, "");

    if (isSmtpConfigured()) {
      this.transporter = nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.port === 465,
        auth: {
          user: config.smtp.user,
          pass: config.smtp.pass,
        },
      });
    }
  }

  async sendInvitation(input: {
    to: string;
    invitedBy: string;
    organizationName: string;
    role: string;
    token: string;
  }): Promise<void> {
    const inviteLink = `${this.appBaseUrl}/invite/${input.token}`;

    if (this.transporter) {
      // ─── Real SMTP ───
      await this.transporter.sendMail({
        from: config.smtp.from,
        to: input.to,
        subject: `您已被邀请加入 ${input.organizationName}`,
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
            <h2>加入 ${input.organizationName}</h2>
            <p>${input.invitedBy} 邀请您加入 <strong>${input.organizationName}</strong>，角色为 <strong>${input.role}</strong>。</p>
            <a href="${inviteLink}"
               style="display:inline-block;padding:12px 24px;background:#000;color:#fff;border-radius:8px;text-decoration:none;margin:16px 0;">
              接受邀请
            </a>
            <p style="color:#888;font-size:12px;">此链接 7 天内有效。</p>
          </div>
        `,
      });
    } else {
      // ─── Console fallback ───
      console.log("");
      console.log("═══════════════════════════════════════════");
      console.log("  📧 Invitation Email (development mode)");
      console.log("═══════════════════════════════════════════");
      console.log(`  To:           ${input.to}`);
      console.log(`  Invited by:   ${input.invitedBy}`);
      console.log(`  Organization: ${input.organizationName}`);
      console.log(`  Role:         ${input.role}`);
      console.log(`  Link:         ${inviteLink}`);
      console.log("───────────────────────────────────────────");
      console.log("  To send real emails, set SMTP env vars:");
      console.log("  ZIPSHIP_SMTP_HOST, _USER, _PASS, _FROM");
      console.log("═══════════════════════════════════════════");
      console.log("");
    }
  }
}
