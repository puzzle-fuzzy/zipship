import { createRoot } from "react-dom/client";
import { ConsoleApp } from "@zipship/console-app";
import { createWebRuntime } from "@zipship/runtime";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing #root element");
}

createRoot(root).render(<ConsoleApp runtime={createWebRuntime()} />);
