import "./index.css";
import { ConsoleApp } from "@zipship/console-core";
import { createRoot } from "react-dom/client";
import { createDesktopRuntime } from "@zipship/runtime";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing #root element");
}

const apiBaseUrl = "http://localhost:3001";

createRoot(root).render(
  <ConsoleApp runtime={createDesktopRuntime(apiBaseUrl)} routerMode="hash" />,
);
