import { ConsoleApp } from '@zipship/console-app';
import { createDesktopRuntime } from '@zipship/runtime';
import { createRoot } from 'react-dom/client';

import './main.css'

const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing #root element');
}

const apiBaseUrl = import.meta.env.VITE_ZIPSHIP_API_BASE_URL ?? 'http://localhost:3001';

createRoot(root).render(<ConsoleApp runtime={createDesktopRuntime()} apiBaseUrl={apiBaseUrl} />);
