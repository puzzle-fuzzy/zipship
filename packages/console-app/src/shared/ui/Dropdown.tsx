import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import styles from './Dropdown.module.css';

interface DropdownItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onClick: () => void;
}

interface DropdownProps {
  trigger: ReactNode;
  items: (DropdownItem | { divider: true })[];
  upward?: boolean;
}

export function Dropdown({ trigger, items, upward = false }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const menuClass = `${styles.menu} ${upward ? styles.menuUp : styles.menuDown}`;

  return (
    <div className={styles.wrapper} ref={ref}>
      <button type="button" className={styles.trigger} onClick={() => setOpen(!open)}>
        {trigger}
      </button>
      {open && (
        <div className={menuClass}>
          {items.map((item, i) =>
            'divider' in item ? (
              <div key={i} className={styles.divider} />
            ) : (
              <button
                key={i}
                type="button"
                className={`${styles.item}${item.danger ? ` ${styles.itemDanger}` : ''}`}
                onClick={() => {
                  item.onClick();
                  setOpen(false);
                }}
              >
                {item.icon}
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
