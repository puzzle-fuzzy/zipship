import type { Project, Release } from '../../stores/projectsStore';
import { ProjectProductionAccessSettings } from './ProjectProductionAccessSettings';
import { ProjectProfileSettings } from './ProjectProfileSettings';
import type { ProjectSettingsSaveInput } from './projectSettingsTypes';

interface ProjectSettingsTabProps {
  project: Project;
  activeRelease: Release | undefined;
  canManage: boolean;
  onSave: (input: ProjectSettingsSaveInput) => Promise<void>;
}

export function ProjectSettingsTab({
  project,
  activeRelease,
  canManage,
  onSave,
}: ProjectSettingsTabProps) {
  return (
    <div className="flex flex-col gap-4">
      <ProjectProfileSettings project={project} canManage={canManage} onSave={onSave} />
      <ProjectProductionAccessSettings
        project={project}
        activeRelease={activeRelease}
        canManage={canManage}
        onSave={onSave}
      />
    </div>
  );
}
