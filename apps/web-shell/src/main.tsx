import { createRoot } from "react-dom/client";
import { ConsoleApp } from "@zipship/console-app";
import { createWebRuntime } from "@zipship/runtime";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing #root element");
}

const apiBaseUrl = import.meta.env.VITE_ZIPSHIP_API_BASE_URL ?? 'http://localhost:5006';
const accessBaseUrl = import.meta.env.VITE_ZIPSHIP_ACCESS_BASE_URL ?? 'http://localhost:5007';

createRoot(root).render(
  <ConsoleApp
    runtime={createWebRuntime()}
    apiBaseUrl={apiBaseUrl}
    accessBaseUrl={accessBaseUrl}
  />,
);
