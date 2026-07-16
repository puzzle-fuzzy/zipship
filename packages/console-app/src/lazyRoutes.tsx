import { lazy } from 'react';

export const AppLayout = lazy(async () => ({
  default: (await import('./features/layout/AppLayout')).AppLayout,
}));
export const ProjectListPage = lazy(async () => ({
  default: (await import('./pages/ProjectListPage')).ProjectListPage,
}));
export const ProjectDetailPage = lazy(async () => ({
  default: (await import('./pages/ProjectDetailPage')).ProjectDetailPage,
}));
export const LoginPage = lazy(async () => ({
  default: (await import('./pages/LoginPage')).LoginPage,
}));
export const ForgotPasswordPage = lazy(async () => ({
  default: (await import('./pages/ForgotPasswordPage')).ForgotPasswordPage,
}));
export const ResetPasswordPage = lazy(async () => ({
  default: (await import('./pages/ResetPasswordPage')).ResetPasswordPage,
}));
export const InvitationAcceptPage = lazy(async () => ({
  default: (await import('./pages/InvitationAcceptPage')).InvitationAcceptPage,
}));
