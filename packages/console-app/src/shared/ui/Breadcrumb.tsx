import type { ReactNode } from 'react';
import styles from './Breadcrumb.module.css';

interface Crumb {
  label: string;
  onClick?: () => void;
}

interface BreadcrumbProps {
  items: Crumb[];
}

export function Breadcrumb({ items }: BreadcrumbProps) {
  return (
    <nav className={styles.nav}>
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} className={styles.item}>
            {i > 0 && <span className={styles.separator}>/</span>}
            {isLast ? (
              <span className={styles.current}>{item.label}</span>
            ) : (
              <button type="button" className={styles.link} onClick={item.onClick}>
                {item.label}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
