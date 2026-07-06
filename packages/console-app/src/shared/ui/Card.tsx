import type { ReactNode } from 'react';
import styles from './Card.module.css';

interface CardProps {
  children: ReactNode;
  title?: string;
  description?: string;
  action?: ReactNode;
}

export function Card({ children, title, description, action }: CardProps) {
  return (
    <div className={styles.card}>
      {(title || action) && (
        <div className={styles.header}>
          <div>
            {title && <div className={styles.title}>{title}</div>}
            {description && <div className={styles.description}>{description}</div>}
          </div>
          {action && <div>{action}</div>}
        </div>
      )}
      <div className={styles.content}>{children}</div>
    </div>
  );
}
