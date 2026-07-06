import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback } from './avatar';

interface Props {
  user: { id: string; name: string; email?: string };
  showEmail?: boolean;
  avatarSize?: 'sm' | 'md';
  className?: string;
}

const sizeMap = { sm: 'size-6', md: 'size-8' } as const;

function getUserInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function UserDisplay({
  user,
  showEmail,
  avatarSize = 'sm',
  className,
}: Props) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Avatar className={sizeMap[avatarSize]}>
        <AvatarFallback>{getUserInitials(user.name)}</AvatarFallback>
      </Avatar>
      <div className="flex flex-col leading-tight">
        <span className="text-sm font-medium truncate max-w-32">
          {user.name}
        </span>
        {showEmail && (
          <span className="text-xs text-muted-foreground truncate max-w-32">
            {user.email}
          </span>
        )}
      </div>
    </div>
  );
}
