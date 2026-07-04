import { describe, expect, test } from "bun:test";
import { AuditService } from "../../apps/api/src/modules/audit/service";

describe("audit service", () => {
  test("records a stable audit event with actor, target, and metadata", async () => {
    const records: unknown[] = [];
    const audit = new AuditService({
      repository: {
        async createAuditLog(input) {
          records.push(input);
          return {
            id: "audit-1",
            ...input,
            createdAt: input.createdAt.toISOString(),
          };
        },
      },
      now: () => new Date("2026-07-05T00:00:00.000Z"),
    });

    const result = await audit.record({
      organizationId: "org-1",
      projectId: "project-1",
      actorId: "user-1",
      action: "auth.login_succeeded",
      targetType: "session",
      targetId: "session-1",
      metadata: {
        clientType: "desktop",
      },
      ipAddress: "127.0.0.1",
      userAgent: "ZipShip Desktop",
    });

    expect(result).toEqual({
      id: "audit-1",
      organizationId: "org-1",
      projectId: "project-1",
      actorId: "user-1",
      action: "auth.login_succeeded",
      targetType: "session",
      targetId: "session-1",
      metadata: {
        clientType: "desktop",
      },
      ipAddress: "127.0.0.1",
      userAgent: "ZipShip Desktop",
      createdAt: "2026-07-05T00:00:00.000Z",
    });
    expect(records).toEqual([
      {
        organizationId: "org-1",
        projectId: "project-1",
        actorId: "user-1",
        action: "auth.login_succeeded",
        targetType: "session",
        targetId: "session-1",
        metadata: {
          clientType: "desktop",
        },
        ipAddress: "127.0.0.1",
        userAgent: "ZipShip Desktop",
        createdAt: new Date("2026-07-05T00:00:00.000Z"),
      },
    ]);
  });
});
