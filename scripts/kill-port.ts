const ports = process.argv.slice(2);

if (ports.length === 0) {
  console.error("Usage: bun scripts/kill-port.ts <port> [port...]");
  process.exit(1);
}

const isWindows = process.platform === "win32";

function findPidsOnPort(port: string): string[] {
  if (isWindows) {
    const netstat = Bun.spawnSync(["netstat", "-ano"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const pids: string[] = [];
    const lines = netstat.stdout.toString().split("\n");
    for (const line of lines) {
      // Windows netstat lines match the local-address column, e.g. "0.0.0.0:3001" or "[::]:3001"
      if (!line.includes("LISTENING")) continue;
      const parts = line.trim().split(/\s+/);
      // local address is column 2 (0-indexed: 1), PID is the last column
      const localAddress = parts[1];
      const pid = parts[parts.length - 1];
      if (localAddress && pid) {
        const portSuffix = `:${port}`;
        if (localAddress.endsWith(portSuffix) && !pids.includes(pid)) {
          pids.push(pid);
        }
      }
    }
    return pids;
  }

  const lsof = Bun.spawnSync(["lsof", "-ti", `tcp:${port}`], {
    stdout: "pipe",
    stderr: "pipe",
  });

  return lsof.stdout
    .toString()
    .split("\n")
    .map((pid) => pid.trim())
    .filter(Boolean);
}

function killPid(pid: string): { exitCode: number; stderr: string } {
  const args = isWindows ? ["taskkill", "/F", "/PID", pid] : ["kill", "-9", pid];
  const result = Bun.spawnSync(args, {
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: result.exitCode, stderr: result.stderr.toString().trim() };
}

for (const port of ports) {
  const pids = findPidsOnPort(port);

  for (const pid of pids) {
    const killed = killPid(pid);

    if (killed.exitCode === 0) {
      console.log(`Killed process ${pid} on port ${port}`);
    } else {
      console.warn(`Failed to kill process ${pid} on port ${port}: ${killed.stderr}`);
    }
  }
}
