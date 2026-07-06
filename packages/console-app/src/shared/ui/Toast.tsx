import { IconCheck, IconCircleX, IconInfoCircle, IconX } from '@tabler/icons-react';
import { useToastStore } from '../../stores/toastStore';
import styles from './Toast.module.css';

const iconMap = {
  success: <IconCheck size={16} style={{ color: 'var(--color-success)' }} />,
  error: <IconCircleX size={16} style={{ color: 'var(--color-error)' }} />,
  info: <IconInfoCircle size={16} style={{ color: 'var(--color-text-secondary)' }} />,
};

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className={styles.container}>
      {toasts.map((toast) => (
        <div key={toast.id} className={`${styles.toast} ${styles[toast.type]}`}>
          <span className={styles.icon}>{iconMap[toast.type]}</span>
          <div className={styles.body}>
            <div className={styles.title}>{toast.title}</div>
            {toast.message && <div className={styles.message}>{toast.message}</div>}
          </div>
          <button type="button" className={styles.close} onClick={() => removeToast(toast.id)}>
            <IconX size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
