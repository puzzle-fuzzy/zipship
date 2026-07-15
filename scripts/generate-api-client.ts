import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const contract = join(root, "packages/api-client/openapi/zipship.json");
const generated = join(root, "packages/api-client/src/generated/schema.ts");
const check = Bun.argv.includes("--check");

async function run(command: string[]): Promise<void> {
  const process = Bun.spawn(command, {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed (${exitCode}): ${command.join(" ")}`);
  }
}

let temporaryDirectory: string | undefined;
try {
  if (!check) {
    await run([
      "cargo",
      "run",
      "--quiet",
      "-p",
      "zipship-api",
      "--bin",
      "zipship-openapi",
      "--",
      contract,
    ]);
  }

  temporaryDirectory = check
    ? await mkdtemp(join(tmpdir(), "zipship-api-contract-"))
    : undefined;
  const output = temporaryDirectory
    ? join(temporaryDirectory, "schema.ts")
    : generated;
  await run([
    process.execPath,
    "x",
    "openapi-typescript",
    contract,
    "--output",
    output,
  ]);

  if (check) {
    const [expected, actual] = await Promise.all([
      readFile(generated, "utf8"),
      readFile(output, "utf8"),
    ]);
    if (expected !== actual) {
      throw new Error(
        "Generated TypeScript contract is stale; run `bun run api:generate`",
      );
    }
  }
} finally {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
