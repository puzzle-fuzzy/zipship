/**
 * Email module — internal (no HTTP routes). Sends transactional email
 * (invitations, etc.) via SMTP when configured, otherwise logs a structured
 * dev fallback.
 */
export { EmailService } from "./service";
export type { EmailServiceOptions } from "./service";
