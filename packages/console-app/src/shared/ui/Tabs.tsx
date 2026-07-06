import type { ReactNode } from 'react';
import { useState } from 'react';
import styles from './Tabs.module.css';

interface Tab {
  id: string;
  label: string;
  icon?: ReactNode;
  content: ReactNode;
}

interface TabsProps {
  tabs: Tab[];
  defaultTab?: string;
  onTabChange?: (tabId: string) => void;
}

export function Tabs({ tabs, defaultTab, onTabChange }: TabsProps) {
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.id ?? '');

  const handleTab = (tabId: string) => {
    setActive(tabId);
    onTabChange?.(tabId);
  };

  return (
    <div className={styles.tabs}>
      <div className={styles.list}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`${styles.trigger}${active === tab.id ? ` ${styles.triggerActive}` : ''}`}
            onClick={() => handleTab(tab.id)}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div key={tab.id} className={`${styles.content}${active !== tab.id ? ` ${styles.contentHidden}` : ''}`}>
          {tab.content}
        </div>
      ))}
    </div>
  );
}
