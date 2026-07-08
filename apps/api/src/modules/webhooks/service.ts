import { createHmac } from "crypto";
import { parseBearerToken } from "../../lib/auth";
import { logger } from "../../lib/logger";
import { PermissionService } from "../permissions/service";
import type { MemberRole } from "../permissions/model";
import type { AuthRepository } from "../auth/service";
import type { CreateWebhookBody, WebhookHeaders, WebhookList } from "./model";

export interface WebhookRecord {
  id: string;
  url: string;
  secret: string;
  events: string[];
  createdAt: Date;
}

export interface WebhooksRepository {
  createWebhook(input: {
    organizationId: string;
    url: string;
    secret: string;
    events: string[];
  }): Promise<{ id: string; url: string; events: string[]; createdAt: Date }>;
  listWebhooksForOrganization(
    organizationId: string,
  ): Promise<Array<{ id: string; url: string; events: string[]; createdAt: Date }>>;
  revokeWebhook(input: { organizationId: string; webhookId: string }): Promise<boolean>;
  listActiveByEvent(
    organizationId: string,
    event: string,
  ): Promise<Array<{ url: string; secret: string }>>;
}

export interface WebhookServiceOptions {
  repository: WebhooksRepository;
  sessionRepository: Pick<AuthRepository, "findSessionByRefreshTokenHash">;
  organizationsRepository: {
    findMembership(input: { organizationId: string; userId: string }): Promise<{ role: MemberRole } | null>;
  };
  hashRefreshToken: (token: string) => Promise<string>;
  now: () => Date;
  /** HMAC sign (payload, secret) → hex. Injectable for tests. */
  sign?: (payload: string, secret: string) => string;
  /** HTTP fetch. Injectable for tests. */
  fetch?: typeof fetch;
  randomSecret?: () => string;
  permissions?: PermissionService;
}

export class WebhookServiceError {
  constructor(public readonly code: "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND") {}
}

export class WebhookService {
  private readonly permissions: PermissionService;
  private readonly sign: (payload: string, secret: string) => string;
  private readonly fetchFn: typeof fetch;
  private readonly randomSecret: () => string;

  constructor(private readonly options: WebhookServiceOptions) {
    this.permissions = options.permissions ?? new PermissionService();
    this.sign =
      options.sign ??
      ((payload, secret) => createHmac("sha256", secret).update(payload).digest("hex"));
    this.fetchFn = options.fetch ?? fetch;
    this.randomSecret =
      options.randomSecret ??
      (() => createHmac("sha256", `wh-${options.now().getTime()}-${Math.random()}`).digest("hex"));
  }

  private async resolveUser(headers: WebhookHeaders) {
    const token = parseBearerToken(headers.authorization);
    if (!token) return null;
    return this.options.sessionRepository.findSessionByRefreshTokenHash(
      await this.options.hashRefreshToken(token),
      this.options.now(),
    );
  }

  async create(
    headers: WebhookHeaders,
    params: { organizationId: string },
    body: CreateWebhookBody,
  ): Promise<{ id: string; url: string; events: string[]; createdAt: string } | WebhookServiceError> {
    const session = await this.resolveUser(headers);
    if (!session) return new WebhookServiceError("UNAUTHORIZED");

    const membership = await this.options.organizationsRepository.findMembership({
      organizationId: params.organizationId,
      userId: session.user.id,
    });
    if (!membership || !this.permissions.can(membership.role, "manage_member")) {
      return new WebhookServiceError("FORBIDDEN");
    }

    const created = await this.options.repository.createWebhook({
      organizationId: params.organizationId,
      url: body.url,
      secret: this.randomSecret(),
      events: body.events,
    });
    return {
      id: created.id,
      url: created.url,
      events: created.events,
      createdAt: created.createdAt.toISOString(),
    };
  }

  async list(
    headers: WebhookHeaders,
    params: { organizationId: string },
  ): Promise<WebhookList | WebhookServiceError> {
    const session = await this.resolveUser(headers);
    if (!session) return new WebhookServiceError("UNAUTHORIZED");

    const membership = await this.options.organizationsRepository.findMembership({
      organizationId: params.organizationId,
      userId: session.user.id,
    });
    if (!membership || !this.permissions.can(membership.role, "view_organization")) {
      return new WebhookServiceError("FORBIDDEN");
    }

    const webhooks = await this.options.repository.listWebhooksForOrganization(params.organizationId);
    return {
      webhooks: webhooks.map((w) => ({
        id: w.id,
        url: w.url,
        events: w.events,
        createdAt: w.createdAt.toISOString(),
      })),
    };
  }

  async revoke(
    headers: WebhookHeaders,
    params: { organizationId: string; webhookId: string },
  ): Promise<{ ok: true } | WebhookServiceError> {
    const session = await this.resolveUser(headers);
    if (!session) return new WebhookServiceError("UNAUTHORIZED");

    const membership = await this.options.organizationsRepository.findMembership({
      organizationId: params.organizationId,
      userId: session.user.id,
    });
    if (!membership || !this.permissions.can(membership.role, "manage_member")) {
      return new WebhookServiceError("FORBIDDEN");
    }

    const found = await this.options.repository.revokeWebhook({
      organizationId: params.organizationId,
      webhookId: params.webhookId,
    });
    if (!found) return new WebhookServiceError("NOT_FOUND");
    return { ok: true };
  }

  /**
   * Fire-and-forget delivery: POST a signed JSON payload to every active
   * webhook subscribed to `event`. Never throws — delivery failures are logged
   * so a flaky endpoint can't fail the deploy that triggered it.
   */
  async dispatch(event: string, input: { organizationId: string; payload: unknown }): Promise<void> {
    let targets: Array<{ url: string; secret: string }>;
    try {
      targets = await this.options.repository.listActiveByEvent(input.organizationId, event);
    } catch (err) {
      logger.error("webhook lookup failed", { event, error: String(err) });
      return;
    }
    if (targets.length === 0) return;

    const body = JSON.stringify({
      event,
      deliveredAt: this.options.now().toISOString(),
      data: input.payload,
    });

    await Promise.all(
      targets.map(async (target) => {
        try {
          const res = await this.fetchFn(target.url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-zipship-event": event,
              "x-zipship-signature": this.sign(body, target.secret),
            },
            body,
          });
          if (!res.ok) {
            logger.warn("webhook delivery non-2xx", { event, url: target.url, status: res.status });
          }
        } catch (err) {
          logger.warn("webhook delivery failed", { event, url: target.url, error: String(err) });
        }
      }),
    );
  }
}
