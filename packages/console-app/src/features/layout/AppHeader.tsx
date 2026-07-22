import { Link } from 'react-router';
import { MaterialIcon } from '../../components/MaterialIcon';
import { AvatarDropdown } from '../../components/primitives/avatar-dropdown';
import { Select } from '../../components/primitives/select';
import { useTranslation } from '../../i18n';
import type { Organization } from '../../stores';

interface AppHeaderProps {
  user: { id: string; name: string; email: string };
  organizations: Array<Pick<Organization, 'id' | 'name' | 'slug' | 'role'>>;
  selectedOrganizationId: string | null;
  organizationsLoading: boolean;
  onOrganizationChange: (organizationId: string) => void;
  onLogout: () => void;
  onOpenSettings?: () => void;
  onOpenProfile?: () => void;
}

export function AppHeader({
  user,
  organizations,
  selectedOrganizationId,
  organizationsLoading,
  onOrganizationChange,
  onLogout,
  onOpenSettings,
  onOpenProfile,
}: AppHeaderProps) {
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 z-30 border-b bg-background">
      <div className="mx-auto flex h-16 w-full max-w-[67.5rem] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <Link
            to="/app/projects"
            aria-label={t('app.name')}
            className="group flex min-h-11 shrink-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:pr-3"
          >
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-[filter] duration-200 group-hover:brightness-110">
              <MaterialIcon name="deployed_code" className="text-[18px]" />
            </span>
            <span className="hidden text-[15px] font-semibold tracking-[-0.01em] sm:inline">
              {t('app.name')}
            </span>
          </Link>

          <div className="min-w-0 border-l pl-2 sm:pl-3">
            <label className="sr-only" htmlFor="organization-context">
              {t('organizations.label')}
            </label>
            <Select
              id="organization-context"
              aria-label={t('organizations.label')}
              value={selectedOrganizationId ?? ''}
              disabled={organizationsLoading || organizations.length === 0}
              size="sm"
              className="min-w-0 max-w-40 sm:max-w-56"
              onValueChange={onOrganizationChange}
            >
              {organizations.length === 0 ? (
                <option value="">
                  {organizationsLoading
                    ? t('organizations.loading')
                    : t('organizations.none')}
                </option>
              ) : null}
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="flex shrink-0 items-center">
          <AvatarDropdown
            user={user}
            onLogout={onLogout}
            onOpenSettings={onOpenSettings}
            onOpenProfile={onOpenProfile}
          />
        </div>
      </div>
    </header>
  );
}
