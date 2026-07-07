import { createRoot } from "react-dom/client";
import { ConsoleApp } from "@zipship/console-core";
import { createWebRuntime } from "@zipship/runtime";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing #root element");
}

const apiBaseUrl = import.meta.env.VITE_ZIPSHIP_API_BASE_URL ?? 'http://localhost:3001';

createRoot(root).render(
  <ConsoleApp runtime={createWebRuntime(apiBaseUrl)} routerMode="browser" />
);
