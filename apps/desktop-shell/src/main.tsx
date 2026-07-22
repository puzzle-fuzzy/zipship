import { ConsoleApp } from '@zipship/console-app';
import { createDesktopRuntime } from '@zipship/runtime';
import { openUrl } from '@tauri-apps/plugin-opener';
import { createRoot } from 'react-dom/client';

import './main.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing #root element');
}

const apiBaseUrl = import.meta.env.VITE_ZIPSHIP_API_BASE_URL ?? 'http://localhost:5006';
const accessBaseUrl = import.meta.env.VITE_ZIPSHIP_ACCESS_BASE_URL ?? 'http://localhost:5007';

createRoot(root).render(
  <ConsoleApp
    runtime={createDesktopRuntime((url) => openUrl(url))}
    apiBaseUrl={apiBaseUrl}
    accessBaseUrl={accessBaseUrl}
  />,
);
