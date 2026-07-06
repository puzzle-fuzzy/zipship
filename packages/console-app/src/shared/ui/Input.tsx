import type { ReactNode } from 'react';
import styles from './Input.module.css';

interface InputProps {
  label?: string;
  type?: 'text' | 'email' | 'password';
  placeholder?: string;
  value: string;
  error?: string;
  hint?: string;
  icon?: ReactNode;
  onChange: (value: string) => void;
}

export function Input({
  label,
  type = 'text',
  placeholder,
  value,
  error,
  hint,
  icon,
  onChange,
}: InputProps) {
  const inputClass = [
    styles.input,
    icon ? styles.inputWithIcon : '',
    error ? styles.inputError : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={styles.wrapper}>
      {label && <label className={styles.label}>{label}</label>}
      <div className={styles.inputWrapper}>
        {icon && <span className={styles.icon}>{icon}</span>}
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      </div>
      {error && <span className={styles.error}>{error}</span>}
      {hint && !error && <span className={styles.hint}>{hint}</span>}
    </div>
  );
}
