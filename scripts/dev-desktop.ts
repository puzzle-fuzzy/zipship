/**
 * Desktop-shell dev launcher.
 *
 * Kills orphaned processes before starting, and cleans up the full
 * electron-forge → Electron process tree when the terminal is closed
 * (Ctrl+C / terminal window close / SIGHUP on Git Bash).
 */
import { spawnSync, spawn } from "bun";
import { resolve } from "path";

const isWindows = process.platform === "win32";
const ROOT_DIR = resolve(import.meta.dir, "..");

// ── Step 1: Kill any leftover processes from a previous run ──────────────
spawnSync(["bun", "scripts/kill-port.ts", "5174", "--electron"], {
  cwd: ROOT_DIR,
  stdout: "inherit",
  stderr: "inherit",
});

// ── Step 2: Start electron-forge ────────────────────────────────────────
// Resolve the electron-forge binary (hoisted to root node_modules/.bin by Bun workspaces)
const forgeBin = resolve(
  ROOT_DIR,
  isWindows
    ? "node_modules/.bin/electron-forge.cmd"
    : "node_modules/.bin/electron-forge",
);

console.log("Starting desktop-shell dev server...");
console.log(`  electron-forge: ${forgeBin}`);

const proc = spawn([forgeBin, "start"], {
  cwd: resolve(ROOT_DIR, "apps/desktop-shell"),
  stdio: ["inherit", "inherit", "inherit"],
});

// ── Step 3: Cleanup on terminal close ───────────────────────────────────
function cleanup() {
  if (!proc.pid) return;

  try {
    if (isWindows) {
      // Kill the electron-forge process tree (catches Electron too)
      spawnSync(["taskkill", "/F", "/T", "/PID", String(proc.pid)], {
        stdout: "pipe",
        stderr: "pipe",
      });
      // Also kill any orphaned raw electron.exe (dev-mode, not packaged apps)
      spawnSync(["taskkill", "/F", "/IM", "electron.exe", "/T"], {
        stdout: "pipe",
        stderr: "pipe",
      });
    } else {
      proc.kill("SIGTERM");
    }
  } catch {
    // Best-effort cleanup
  }
}

// Git Bash sends SIGHUP when the terminal window is closed.
// Ctrl+C sends SIGINT, SIGTERM handles other kill scenarios.
process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});
process.on("SIGHUP", () => {
  cleanup();
  process.exit(0);
});

await proc.exited;
