import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useAuthStore } from '../../stores/authStore';

export function PublicOnly({ children }: { children: ReactNode }) {
  const status = useAuthStore((state) => state.status);
  return status === 'authenticated' ? <Navigate to="/app" replace /> : children;
}

export function AuthenticatedOnly({ children }: { children: ReactNode }) {
  const status = useAuthStore((state) => state.status);
  return status === 'authenticated' ? children : <Navigate to="/login" replace />;
}

export function HomeRedirect() {
  const status = useAuthStore((state) => state.status);
  return <Navigate to={status === 'authenticated' ? '/app' : '/login'} replace />;
}
