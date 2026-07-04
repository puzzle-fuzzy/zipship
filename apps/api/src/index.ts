import { Elysia } from "elysia";

export const app = new Elysia()
  .get("/_health", () => ({
    status: "ok",
    service: "zipship-api",
  }));

export type App = typeof app;

if (import.meta.main) {
  const port = Number(process.env.ZIPSHIP_API_PORT ?? 3001);

  app.listen(port);
  console.log(`ZipShip API listening on http://localhost:${port}`);
}
