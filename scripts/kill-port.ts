const ports = process.argv.slice(2);

if (ports.length === 0) {
  console.error("Usage: bun scripts/kill-port.ts <port> [port...]");
  process.exit(1);
}

for (const port of ports) {
  const lsof = Bun.spawnSync(["lsof", "-ti", `tcp:${port}`], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const pids = lsof.stdout
    .toString()
    .split("\n")
    .map((pid) => pid.trim())
    .filter(Boolean);

  for (const pid of pids) {
    const killed = Bun.spawnSync(["kill", "-9", pid], {
      stdout: "pipe",
      stderr: "pipe",
    });

    if (killed.exitCode === 0) {
      console.log(`Killed process ${pid} on port ${port}`);
    } else {
      console.warn(`Failed to kill process ${pid} on port ${port}: ${killed.stderr.toString().trim()}`);
    }
  }
}
