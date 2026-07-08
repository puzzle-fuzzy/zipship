import { create } from 'zustand';
import { authHeaders, getApi } from '../api/client';

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
  fetchAudit: (organizationId: string) => Promise<void>;
}

/** Organization-scoped audit trail. Backed by GET /_api/organizations/:id/audit. */
export const useAuditStore = create<AuditState>((set) => ({
  logs: [],
  loading: false,

  fetchAudit: async (organizationId: string) => {
    set({ loading: true });
    try {
      const res = await getApi()._api.organizations({ organizationId }).audit.get({
        headers: authHeaders(),
      });
      if (res.data) {
        set({ logs: res.data.auditLogs as AuditLogEntry[], loading: false });
      } else {
        set({ loading: false });
      }
    } catch {
      set({ loading: false });
    }
  },
}));
