import { treaty } from "@elysia/eden";
import type { App } from "@zipship/api";

export function createApiClient(baseUrl: string) {
  return treaty<App>(baseUrl);
}

export type ApiClient = ReturnType<typeof createApiClient>;
