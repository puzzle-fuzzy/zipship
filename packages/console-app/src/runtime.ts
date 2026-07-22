import type { RuntimeAdapter } from '@zipship/runtime';
import { createContext, useContext } from 'react';

export const RuntimeContext = createContext<RuntimeAdapter | null>(null);

export function useRuntime(): RuntimeAdapter {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error('RuntimeProvider is required');
  return runtime;
}
