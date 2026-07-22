import type { RuntimeAdapter } from '@zipship/runtime';
import type { ReactNode } from 'react';
import { RuntimeContext } from './runtime';

export function RuntimeProvider({
  runtime,
  children,
}: {
  runtime: RuntimeAdapter;
  children: ReactNode;
}) {
  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>;
}
