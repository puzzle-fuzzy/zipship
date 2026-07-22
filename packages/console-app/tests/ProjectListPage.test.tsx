import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { ProjectListPage } from '../src/pages/ProjectListPage';
import { useOrganizationsStore } from '../src/stores/organizationsStore';
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
  useOrganizationsStore.setState({
    organizations: [
      {
        id: 'org-1',
        name: 'Acme',
        slug: 'acme',
        role: 'owner',
        createdAt: '2026-07-15T00:00:00Z',
      },
    ],
    selectedOrganizationId: 'org-1',
    loading: false,
    initialized: true,
    error: null,
  });
  useProjectsStore.setState({
    projects: [project],
    projectsOrganizationId: 'org-1',
    projectsError: null,
    loading: false,
  });
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

  it('disables project creation when the account has no organization access', () => {
    const setShowCreate = vi.fn();
    useOrganizationsStore.setState({
      organizations: [],
      selectedOrganizationId: null,
      loading: false,
      initialized: true,
      error: null,
    });
    useProjectsStore.setState({
      projects: [],
      projectsOrganizationId: null,
      projectsError: null,
      loading: false,
    });

    renderPage(setShowCreate);

    expect(screen.getByRole('heading', { name: 'No organization access' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Project' })).toBeDisabled();
    expect(screen.queryByText('No projects yet')).not.toBeInTheDocument();
  });

  it('surfaces organization failures and retries the organization request', () => {
    const setShowCreate = vi.fn();
    const initializeOrganizations = vi.fn().mockResolvedValue(undefined);
    useOrganizationsStore.setState({
      organizations: [],
      selectedOrganizationId: null,
      loading: false,
      initialized: true,
      error: 'offline',
      initializeOrganizations,
    });

    renderPage(setShowCreate);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(screen.getByRole('heading', { name: 'Could not load organizations' })).toBeInTheDocument();
    expect(initializeOrganizations).toHaveBeenCalledOnce();
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
