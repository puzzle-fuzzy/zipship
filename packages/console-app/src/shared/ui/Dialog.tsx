import { IconX } from '@tabler/icons-react';
import type { ReactNode, MouseEvent } from 'react';
import { useRef } from 'react';
import styles from './Dialog.module.css';

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}

export function Dialog({ open, title, onClose, children, width }: DialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  if (!open) return null;

  const handleOverlayClick = (e: MouseEvent) => {
    // Only close if the click started AND ended on the overlay (not a drag from dialog)
    if (e.target === overlayRef.current) {
      onClose();
    }
  };

  return (
    <div className={styles.overlay} ref={overlayRef} onClick={handleOverlayClick}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={width ? { width } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <span className={styles.headerTitle}>{title}</span>
          <button type="button" className={styles.closeBtn} onClick={onClose}>
            <IconX size={18} />
          </button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
