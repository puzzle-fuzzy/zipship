import { createBrowserRouter, Navigate } from 'react-router';
import { AuthenticatedOnly, HomeRedirect, PublicOnly } from './features/auth/AuthRouteGuards';
import {
  AppLayout,
  ForgotPasswordPage,
  InvitationAcceptPage,
  LoginPage,
  LogsPage,
  ProjectDetailPage,
  ProjectListPage,
  ResetPasswordPage,
  StoragePage,
} from './lazyRoutes';

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
    path: '/invitations/accept',
    element: <InvitationAcceptPage />,
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
