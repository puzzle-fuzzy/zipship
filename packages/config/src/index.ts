export const config = {
  apiPort: Number(process.env.ZIPSHIP_API_PORT ?? 3001),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://zipship:zipship@localhost:5432/zipship",
  storageRoot: process.env.ZIPSHIP_STORAGE_ROOT ?? "/srv/zipship",
  smtp: {
    host: process.env.ZIPSHIP_SMTP_HOST ?? "",
    port: Number(process.env.ZIPSHIP_SMTP_PORT ?? 587),
    user: process.env.ZIPSHIP_SMTP_USER ?? "",
    pass: process.env.ZIPSHIP_SMTP_PASS ?? "",
    from: process.env.ZIPSHIP_SMTP_FROM ?? "noreply@zipship.local",
  },
  appUrl: process.env.ZIPSHIP_APP_URL ?? "http://localhost:5173",
};
