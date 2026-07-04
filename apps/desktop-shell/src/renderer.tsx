import './index.css';
import { ConsoleApp } from '@zipship/console-app';
import type { RuntimeAdapter } from '@zipship/runtime';
import { createRoot } from 'react-dom/client';

const desktopRuntime: RuntimeAdapter = {
  kind: 'desktop',
  async openExternal(url) {
    window.open(url, '_blank', 'noopener,noreferrer');
  },
};

const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing #root element');
}

createRoot(root).render(<ConsoleApp runtime={desktopRuntime} />);
