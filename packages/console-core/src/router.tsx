import { createBrowserRouter, createHashRouter, Navigate } from 'react-router';
import { AppLayout } from './features/layout/AppLayout';
import { ProjectListPage } from './pages/ProjectListPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';

const routes = [
  {
    path: '/app',
    element: <AppLayout />,
    children: [
      { index: true, element: <ProjectListPage /> },
      { path: 'projects/:projectId', element: <ProjectDetailPage /> },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/app" replace />,
  },
];

export function router(mode: 'browser' | 'hash' = 'browser') {
  return mode === 'hash' ? createHashRouter(routes) : createBrowserRouter(routes);
}
