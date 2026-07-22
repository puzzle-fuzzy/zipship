import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ProjectDetailPage } from '../src/pages/ProjectDetailPage';
import { useAuditStore } from '../src/stores/auditStore';
import { useAuthStore } from '../src/stores/authStore';
import { useMembersStore } from '../src/stores/membersStore';
import { useOrganizationsStore } from '../src/stores/organizationsStore';
import { useProjectsStore } from '../src/stores/projectsStore';
import { useSettingsStore } from '../src/stores/settingsStore';
import { RuntimeProvider } from '../src/runtime-provider';

const orbitProject = {
  id: 'project-orbit',
  organizationId: 'org-2',
  name: 'Orbit docs',
  slug: 'orbit-docs',
  description: 'Orbit documentation',
  currentReleaseId: null,
  spaFallback: true,
  cachePolicy: 'standard' as const,
  createdBy: 'user-1',
  createdAt: '2026-07-15T00:00:00Z',
  updatedAt: '2026-07-15T00:00:00Z',
};

beforeEach(() => {
  useSettingsStore.setState({ language: 'en' });
  useAuthStore.setState({
    status: 'authenticated',
    user: { id: 'user-1', name: 'Ada', email: 'ada@example.com' },
  });
  useOrganizationsStore.setState({
    organizations: [
      { id: 'org-1', name: 'Acme', slug: 'acme', role: 'owner', createdAt: '2026-07-15T00:00:00Z' },
      { id: 'org-2', name: 'Orbit', slug: 'orbit', role: 'owner', createdAt: '2026-07-15T00:00:00Z' },
    ],
    selectedOrganizationId: 'org-1',
    loading: false,
    initialized: true,
    error: null,
  });
  useProjectsStore.setState({
    projects: [],
    projectsOrganizationId: 'org-1',
    projectsError: null,
    releases: {},
    releaseErrors: {},
    deployments: {},
    deploymentErrors: {},
    loading: false,
    fetchReleases: vi.fn().mockResolvedValue(undefined),
    fetchDeployments: vi.fn().mockResolvedValue(undefined),
  });
  useMembersStore.setState({
    members: [],
    membersOrganizationId: null,
    loading: false,
    error: null,
    invitations: [],
    invitationsOrganizationId: null,
    invitationsLoading: false,
    invitationsError: null,
    fetchMembers: vi.fn().mockResolvedValue(undefined),
    fetchInvitations: vi.fn().mockResolvedValue(undefined),
    clearInvitations: vi.fn(),
  });
  useAuditStore.setState({
    logs: [],
    loading: false,
    error: null,
    fetchAudit: vi.fn().mockResolvedValue(undefined),
  });
});

describe('ProjectDetailPage direct links', () => {
  it('switches to the project organization after resolving a cross-organization link', async () => {
    const resolveProject = vi.fn().mockResolvedValue(orbitProject);
    useProjectsStore.setState({ resolveProject });

    renderPage('project-orbit');

    expect(await screen.findByRole('heading', { name: 'Orbit docs' })).toBeInTheDocument();
    expect(resolveProject).toHaveBeenCalledWith('project-orbit');
    expect(useOrganizationsStore.getState().selectedOrganizationId).toBe('org-2');
  });

  it('ends an inaccessible direct link with an honest not-found state', async () => {
    useProjectsStore.setState({ resolveProject: vi.fn().mockResolvedValue(null) });

    renderPage('missing-project');

    expect(await screen.findByRole('heading', { name: 'Project not found' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to projects' })).toBeInTheDocument();
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });

  it('allows a temporary project lookup failure to be retried', async () => {
    const resolveProject = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(null);
    useProjectsStore.setState({ resolveProject });
    const user = userEvent.setup();
    renderPage('project-orbit');

    expect(await screen.findByRole('heading', { name: 'Could not load project' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(resolveProject).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('heading', { name: 'Project not found' })).toBeInTheDocument();
  });
});

function renderPage(projectId: string) {
  return render(
    <MemoryRouter initialEntries={[`/app/projects/${projectId}`]}>
      <RuntimeProvider runtime={{ kind: 'web', openExternal: vi.fn() }}>
        <Routes>
          <Route path="/app/projects/:projectId" element={<ProjectDetailPage />} />
          <Route path="/app/projects" element={<div>Project list</div>} />
        </Routes>
      </RuntimeProvider>
    </MemoryRouter>,
  );
}
