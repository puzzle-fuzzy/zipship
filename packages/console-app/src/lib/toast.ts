import type { ReactNode } from 'react';

export type ToastKind = 'error' | 'info' | 'success' | 'warning';

export interface ToastEntry {
  id: number;
  kind: ToastKind;
  message: ReactNode;
}

const listeners = new Set<() => void>();
let entries: readonly ToastEntry[] = [];
let nextId = 1;

function emit() {
  for (const listener of listeners) listener();
}

function dismiss(id: number) {
  const nextEntries = entries.filter((entry) => entry.id !== id);
  if (nextEntries.length === entries.length) return;
  entries = nextEntries;
  emit();
}

function publish(kind: ToastKind, message: ReactNode, duration = 5000) {
  const id = nextId++;
  entries = [...entries, { id, kind, message }];
  emit();
  if (duration > 0) window.setTimeout(() => dismiss(id), duration);
  return id;
}

export const toast = {
  dismiss,
  error: (message: ReactNode, duration?: number) => publish('error', message, duration),
  info: (message: ReactNode, duration?: number) => publish('info', message, duration),
  success: (message: ReactNode, duration?: number) => publish('success', message, duration),
  warning: (message: ReactNode, duration?: number) => publish('warning', message, duration),
};

export function subscribeToToasts(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getToastSnapshot() {
  return entries;
}
