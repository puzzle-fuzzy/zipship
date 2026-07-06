import { spawnSync } from "bun";

const ports = process.argv.slice(2);

if (ports.length === 0) {
  console.error("Usage: bun scripts/kill-port.ts <port> [port...]");
  process.exit(1);
}

const isWindows = process.platform === "win32";

/**
 * Quick check: is anything listening on `port`?
 *
 * On Windows, runs `netstat -ano | findstr :${port}` which is far faster
 * than parsing the full netstat output (findstr filters at the OS level).
 * On Unix, uses `lsof -ti tcp:${port}`.
 */
function findPidsOnPort(port: string): string[] {
  if (isWindows) {
    // findstr is far faster than parsing 1000+ netstat lines in JS
    const result = spawnSync(["cmd", "/c", `netstat -ano | findstr ":${port} "`], {
      stdout: "pipe",
      stderr: "pipe",
    });

    if (result.exitCode !== 0) return []; // findstr exits 1 when no match

    const pids: string[] = [];
    for (const line of result.stdout.toString().split("\n")) {
      if (!line.includes("LISTENING")) continue;
      const parts = line.trim().split(/\s+/);
      const localAddress = parts[1];
      const pid = parts[parts.length - 1];
      if (localAddress?.endsWith(`:${port}`) && pid && !pids.includes(pid)) {
        pids.push(pid);
      }
    }
    return pids;
  }

  const lsof = spawnSync(["lsof", "-ti", `tcp:${port}`], {
    stdout: "pipe",
    stderr: "pipe",
  });

  return lsof.stdout
    .toString()
    .split("\n")
    .map((pid) => pid.trim())
    .filter(Boolean);
}

function killPid(pid: string): boolean {
  const args = isWindows ? ["taskkill", "/F", "/PID", pid] : ["kill", "-9", pid];
  return spawnSync(args, { stdout: "pipe", stderr: "pipe" }).exitCode === 0;
}

for (const port of ports) {
  const pids = findPidsOnPort(port);

  if (pids.length === 0) continue; // port is free, skip silently

  for (const pid of pids) {
    if (killPid(pid)) {
      console.log(`Killed process ${pid} on port ${port}`);
    }
  }
}
