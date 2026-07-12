import nodemailer from "nodemailer";
import { config } from "@zipship/config";
import { logger } from "../../lib/logger";

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
      // SMTP not configured — emit a structured log line instead of sending.
      // Set ZIPSHIP_SMTP_HOST/_USER/_PASS/_FROM to send real email.
      logger.warn("invitation email not sent (smtp not configured — dev fallback)", {
        to: input.to,
        invitedBy: input.invitedBy,
        organization: input.organizationName,
        role: input.role,
        inviteLink,
      });
    }
  }

  async sendPasswordReset(input: { to: string; resetUrl: string }): Promise<void> {
    if (this.transporter) {
      await this.transporter.sendMail({
        from: config.smtp.from,
        to: input.to,
        subject: "Reset your ZipShip password",
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
            <h2>Reset your password</h2>
            <p>Use the link below to set a new password. It expires in 30 minutes.</p>
            <a href="${input.resetUrl}"
               style="display:inline-block;padding:12px 24px;background:#000;color:#fff;border-radius:8px;text-decoration:none;margin:16px 0;">
              Reset password
            </a>
            <p style="color:#888;font-size:12px;">If you didn't request this, you can ignore this email.</p>
          </div>
        `,
      });
    } else {
      logger.warn("password reset email not sent (smtp not configured — dev fallback)", {
        to: input.to,
        resetUrl: input.resetUrl,
      });
    }
  }
}
