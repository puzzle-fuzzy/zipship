import { IconBox, IconFolderOpen, IconPlus, IconRefresh } from '@tabler/icons-react';
import { Badge } from '../../shared/ui/Badge';
import { Button } from '../../shared/ui/Button';
import { Card } from '../../shared/ui/Card';

interface Project {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  currentReleaseId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ProjectListProps {
  projects: Project[];
  loading: boolean;
  onSelect: (project: Project) => void;
  onCreate: () => void;
  onRefresh: () => void;
}

export function ProjectList({ projects, loading, onSelect, onCreate, onRefresh }: ProjectListProps) {
  if (loading) {
    return <Card title="Projects">Loading...</Card>;
  }

  if (projects.length === 0) {
    return (
      <Card>
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
          <IconFolderOpen size={40} style={{ color: 'var(--color-text-tertiary)', marginBottom: 16 }} />
          <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600, marginBottom: 8 }}>No projects yet</h3>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: 20 }}>
            Create your first project to start deploying
          </p>
          <Button onClick={onCreate}>
            <IconPlus size={16} />
            New Project
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card
      title="Projects"
      action={
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="ghost" size="sm" onClick={onRefresh}>
            <IconRefresh size={14} />
          </Button>
          <Button size="sm" onClick={onCreate}>
            <IconPlus size={14} />
            New
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {projects.map((project) => (
          <button
            key={project.id}
            type="button"
            onClick={() => onSelect(project)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              width: '100%',
              padding: '12px 16px',
              border: 'none',
              background: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background 150ms ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <IconBox size={18} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {project.name}
                </span>
                <Badge variant={project.currentReleaseId ? 'success' : 'outline'}>
                  {project.currentReleaseId ? 'Live' : 'Draft'}
                </Badge>
              </div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                /{project.slug}
                {project.description ? ` · ${project.description}` : ''}
              </div>
            </div>
          </button>
        ))}
      </div>
    </Card>
  );
}
