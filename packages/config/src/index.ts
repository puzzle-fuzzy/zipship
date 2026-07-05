export const config = {
  apiPort: Number(process.env.ZIPSHIP_API_PORT ?? 3001),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://zipship:zipship@localhost:5432/zipship",
  storageRoot: process.env.ZIPSHIP_STORAGE_ROOT ?? "/srv/zipship",
};
