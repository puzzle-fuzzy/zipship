import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { ProjectListPage } from '../src/pages/ProjectListPage';
import { useProjectsStore } from '../src/stores/projectsStore';
import { useSettingsStore } from '../src/stores/settingsStore';

const project = {
  id: 'project-1',
  organizationId: 'org-1',
  name: 'Product docs',
  slug: 'product-docs',
  description: 'Public documentation site',
  currentReleaseId: 'release-1',
  spaFallback: true,
  cachePolicy: 'standard' as const,
  createdBy: 'user-1',
  createdAt: '2026-07-15T00:00:00Z',
  updatedAt: '2026-07-16T00:00:00Z',
};

beforeEach(() => {
  useSettingsStore.setState({ language: 'en' });
  useProjectsStore.setState({ projects: [project], loading: false });
});

describe('ProjectListPage', () => {
  it('shows one focused project list without dashboard metric modules', () => {
    const setShowCreate = vi.fn();
    renderPage(setShowCreate);

    expect(screen.getByRole('heading', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByText('1 projects, 1 live')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Product docs/ })).toBeInTheDocument();
    expect(screen.queryByText('Total')).not.toBeInTheDocument();
    expect(screen.queryByText('Recent projects')).not.toBeInTheDocument();
    expect(screen.queryByText('Logs')).not.toBeInTheDocument();
    expect(screen.queryByText('Storage')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'New Project' }));
    expect(setShowCreate).toHaveBeenCalledWith(true);
  });
});

function renderPage(setShowCreate: (value: boolean) => void) {
  return render(
    <MemoryRouter>
      <Routes>
        <Route element={<Outlet context={{ setShowCreate }} />}>
          <Route index element={<ProjectListPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}
