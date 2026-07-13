import { create } from 'zustand';
import { authHeaders, getApi } from '../api/client';
import type { AuditLogEntry } from '../domain/audit';

export type { AuditLogEntry } from '../domain/audit';

interface AuditState {
  logs: AuditLogEntry[];
  loading: boolean;
  /** Set when the last fetch failed; cleared on a successful reload. */
  error: string | null;
  fetchAudit: (organizationId: string) => Promise<void>;
}

/** Organization-scoped audit trail. Backed by GET /_api/organizations/:id/audit. */
export const useAuditStore = create<AuditState>((set) => ({
  logs: [],
  loading: false,
  error: null,

  fetchAudit: async (organizationId: string) => {
    set({ loading: true, error: null });
    try {
      const res = await getApi()._api.organizations({ organizationId }).audit.get({
        headers: authHeaders(),
      });
      if (res.data) {
        set({ logs: res.data.auditLogs as AuditLogEntry[], loading: false, error: null });
      } else {
        // No data and no thrown error → treat as a failed load so the UI can
        // surface it instead of spinning on "Loading..." forever.
        set({ loading: false, error: 'Failed to load activity' });
      }
    } catch {
      set({ loading: false, error: 'Failed to load activity' });
    }
  },
}));
