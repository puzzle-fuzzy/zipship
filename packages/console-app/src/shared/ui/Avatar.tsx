import styles from './Avatar.module.css';

interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg';
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function Avatar({ name, size = 'md' }: AvatarProps) {
  return (
    <span className={`${styles.avatar} ${styles[size]}`} role="img" aria-label={name} title={name}>
      {getInitials(name)}
    </span>
  );
}
