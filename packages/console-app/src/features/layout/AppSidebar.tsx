import { Archive, Box, Ellipsis, Plus } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { Button } from '../../components/ui/button';
import { Separator } from '../../components/ui/separator';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '../../components/ui/sidebar';

interface Project {
  id: string;
  name: string;
  slug: string;
  status: string;
}

interface AppSidebarProps {
  projects: Project[];
  selectedProjectId: string | null;
  onSelectProject: (project: Project) => void;
  onCreateProject: () => void;
}

export function AppSidebar({
  projects,
  selectedProjectId,
  onSelectProject,
  onCreateProject,
}: AppSidebarProps) {
  const { t } = useTranslation();
  const activeProjects = projects.filter((p) => p.status !== "archived");
  const archivedCount = projects.length - activeProjects.length;

  return (
    <Sidebar collapsible="none" className="hidden md:flex p-2">
      <SidebarMenu>
        <SidebarMenuItem className="pt-14">
          <Button
            variant="outline"
            onClick={onCreateProject}
            className="w-full justify-start"
          >
            <Plus />
            <span>{t('app.newProject')}</span>
          </Button>
        </SidebarMenuItem>
      </SidebarMenu>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              <SidebarGroupLabel>{t('app.projects')}</SidebarGroupLabel>
              {projects.map((project) => (
                <SidebarMenuItem key={project.id}>
                  <SidebarMenuButton
                    isActive={selectedProjectId === project.id}
                    onClick={() => onSelectProject(project)}
                  >
                    <Box />
                    <span>{project.name}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {projects.length === 0 && (
                <SidebarMenuItem>
                  <SidebarMenuButton disabled>
                    <Box />
                    <span>{t('app.noProjects')}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              <Separator />

              <SidebarGroupLabel>{t('app.archive')}</SidebarGroupLabel>
              <SidebarMenuItem>
                <SidebarMenuButton disabled={archivedCount === 0}>
                  <Archive />
                  <span>{t('app.archivedProjects')}</span>
                  {archivedCount > 0 && (
                    <span className="ml-auto text-xs text-muted-foreground">{archivedCount}</span>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton className="text-sidebar-foreground/70">
                  <Ellipsis className="text-sidebar-foreground/70" />
                  <span>{t('app.more')}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
