import { z } from "zod";

/**
 * Centralized, validated environment configuration.
 *
 * Parsed once at module load via a zod schema: URLs are validated, ports are
 * coerced + range-checked, required strings are non-empty. A bad value fails
 * fast at startup with a clear error instead of surfacing as a mysterious
 * runtime failure inside a request handler. Everything has a dev fallback so
 * local development works with an empty `.env`.
 */
const ConfigSchema = z.object({
  apiPort: z.coerce.number().int().positive().max(65535).default(3001),
  databaseUrl: z
    .string()
    .min(1)
    .default("postgres://zipship:zipship@localhost:5432/zipship"),
  storageRoot: z.string().min(1).default("/srv/zipship"),
  /** Public base URL of the web console — invitation links, email templates. */
  appUrl: z.string().url().default("http://localhost:5173"),
  smtp: z.object({
    host: z.string().default(""),
    port: z.coerce.number().int().positive().max(65535).default(587),
    user: z.string().default(""),
    pass: z.string().default(""),
    from: z.string().min(1).default("noreply@zipship.local"),
  }),
});

export const config = ConfigSchema.parse({
  apiPort: process.env.ZIPSHIP_API_PORT,
  databaseUrl: process.env.DATABASE_URL,
  storageRoot: process.env.ZIPSHIP_STORAGE_ROOT,
  appUrl: process.env.ZIPSHIP_APP_URL,
  smtp: {
    host: process.env.ZIPSHIP_SMTP_HOST,
    port: process.env.ZIPSHIP_SMTP_PORT,
    user: process.env.ZIPSHIP_SMTP_USER,
    pass: process.env.ZIPSHIP_SMTP_PASS,
    from: process.env.ZIPSHIP_SMTP_FROM,
  },
});

export type Config = z.infer<typeof ConfigSchema>;
