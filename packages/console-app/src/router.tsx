import { createBrowserRouter, Navigate } from 'react-router';
import { AppLayout } from './features/layout/AppLayout';
import { ProjectListPage } from './pages/ProjectListPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { LogsPage } from './pages/LogsPage';
import { StoragePage } from './pages/StoragePage';

export const router = createBrowserRouter([
  {
    path: '/app',
    element: <AppLayout />,
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
    element: <Navigate to="/app" replace />,
  },
]);
