import type { components } from "@zipship/api-client";
import { create } from "zustand";
import { getApi } from "../api/client";

type AuditEntryDto = components["schemas"]["AuditEntryResponse"];

export interface AuditLogEntry {
  id: string;
  action: string;
  actorId: string | null;
  targetType: string;
  targetId: string | null;
  projectId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface AuditState {
  logs: AuditLogEntry[];
  loading: boolean;
  error: string | null;
  fetchAudit: (organizationId: string) => Promise<void>;
}

function auditView(entry: AuditEntryDto): AuditLogEntry {
  return {
    id: entry.id,
    action: entry.action,
    actorId: entry.actor?.id ?? null,
    targetType: entry.targetType,
    targetId: entry.targetId ?? null,
    projectId: entry.projectId ?? null,
    metadata: entry.metadata,
    createdAt: entry.createdAt,
  };
}

export const useAuditStore = create<AuditState>((set) => ({
  logs: [],
  loading: false,
  error: null,

  fetchAudit: async (organizationId) => {
    set({ loading: true, error: null });
    try {
      const result = await getApi().GET(
        "/_api/organizations/{organization_id}/audit-logs",
        { params: { path: { organization_id: organizationId } } },
      );
      if (result.error || !result.data) {
        throw new Error("Failed to load activity");
      }
      set({
        logs: result.data.items.map(auditView),
        loading: false,
        error: null,
      });
    } catch {
      set({ loading: false, error: "Failed to load activity" });
    }
  },
}));
