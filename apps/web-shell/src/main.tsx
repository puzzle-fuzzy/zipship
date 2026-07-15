import { createRoot } from "react-dom/client";
import { ConsoleApp } from "@zipship/console-app";
import { createWebRuntime } from "@zipship/runtime";
import { resolveWebShellConfig } from './runtimeConfig';

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing #root element");
}

const { apiBaseUrl, accessBaseUrl } = resolveWebShellConfig({
  buildApiBaseUrl: import.meta.env.VITE_ZIPSHIP_API_BASE_URL,
  buildAccessBaseUrl: import.meta.env.VITE_ZIPSHIP_ACCESS_BASE_URL,
  development: import.meta.env.DEV,
  runtime: window.__ZIPSHIP_RUNTIME_CONFIG__,
});

createRoot(root).render(
  <ConsoleApp
    runtime={createWebRuntime()}
    apiBaseUrl={apiBaseUrl}
    accessBaseUrl={accessBaseUrl}
  />,
);
