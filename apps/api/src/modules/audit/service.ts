import type { AuditCreateInput, AuditLog, AuditRecordInput } from "./model";

export interface AuditRepository {
  createAuditLog(input: AuditCreateInput): Promise<AuditLog>;
  listAuditLogsForOrganization(organizationId: string, limit?: number): Promise<AuditLog[]>;
}

export interface AuditServiceOptions {
  repository: AuditRepository;
  now: () => Date;
}

export class AuditService {
  constructor(private readonly options: AuditServiceOptions) {}

  async record(input: AuditRecordInput): Promise<AuditLog> {
    return this.options.repository.createAuditLog({
      organizationId: input.organizationId,
      projectId: input.projectId ?? null,
      actorId: input.actorId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      metadata: input.metadata ?? {},
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      createdAt: this.options.now(),
    });
  }
}
