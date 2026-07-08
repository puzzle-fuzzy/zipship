import { t } from "elysia";
import type { Static } from "elysia";

/** Events a webhook can subscribe to. */
export const WEBHOOK_EVENTS = ["release.published", "release.rolled_back"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const webhookHeadersModel = t.Object({
  authorization: t.Optional(t.String()),
});
export type WebhookHeaders = Static<typeof webhookHeadersModel>;

export const webhookParamsModel = t.Object({
  organizationId: t.String(),
});

export const webhookTargetParamsModel = t.Object({
  organizationId: t.String(),
  webhookId: t.String(),
});

export const createWebhookBodyModel = t.Object({
  url: t.String({ minLength: 1 }),
  events: t.Array(t.Union(WEBHOOK_EVENTS.map((e) => t.Literal(e)))),
});
export type CreateWebhookBody = Static<typeof createWebhookBodyModel>;

export const webhookItemModel = t.Object({
  id: t.String(),
  url: t.String(),
  events: t.Array(t.String()),
  createdAt: t.String(),
});
export const webhookListModel = t.Object({ webhooks: t.Array(webhookItemModel) });
export type WebhookList = Static<typeof webhookListModel>;

export const webhookOkModel = t.Object({ ok: t.Literal(true) });

export const webhookErrorModel = t.Object({
  code: t.Union([
    t.Literal("UNAUTHORIZED"),
    t.Literal("FORBIDDEN"),
    t.Literal("NOT_FOUND"),
    t.Literal("VALIDATION_ERROR"),
  ]),
});

export const webhookModels = {
  "Webhook.Headers": webhookHeadersModel,
  "Webhook.Params": webhookParamsModel,
  "Webhook.TargetParams": webhookTargetParamsModel,
  "Webhook.Body": createWebhookBodyModel,
  "Webhook.Item": webhookItemModel,
  "Webhook.List": webhookListModel,
  "Webhook.Ok": webhookOkModel,
  "Webhook.Error": webhookErrorModel,
};
