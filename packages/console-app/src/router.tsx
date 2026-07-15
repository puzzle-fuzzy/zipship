import { createBrowserRouter, Navigate } from 'react-router';
import { AppLayout } from './features/layout/AppLayout';
import { ProjectListPage } from './pages/ProjectListPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { LogsPage } from './pages/LogsPage';
import { StoragePage } from './pages/StoragePage';
import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { AuthenticatedOnly, HomeRedirect, PublicOnly } from './features/auth/AuthRouteGuards';

export const router = createBrowserRouter([
  {
    path: '/login',
    element: (
      <PublicOnly>
        <LoginPage />
      </PublicOnly>
    ),
  },
  {
    path: '/forgot-password',
    element: (
      <PublicOnly>
        <ForgotPasswordPage />
      </PublicOnly>
    ),
  },
  {
    path: '/reset-password',
    element: <ResetPasswordPage />,
  },
  {
    path: '/app',
    element: (
      <AuthenticatedOnly>
        <AppLayout />
      </AuthenticatedOnly>
    ),
    children: [
      // Default app view is the project list.
      { index: true, element: <Navigate to="/app/projects" replace /> },
      { path: 'projects', element: <ProjectListPage /> },
      { path: 'projects/:projectId', element: <ProjectDetailPage /> },
      { path: 'logs', element: <LogsPage /> },
      { path: 'storage', element: <StoragePage /> },
    ],
  },
  {
    path: '*',
    element: <HomeRedirect />,
  },
]);
