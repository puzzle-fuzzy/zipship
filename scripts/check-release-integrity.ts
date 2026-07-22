import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const failures: string[] = [];

function readRequired(relativePath: string): string {
  const path = join(root, relativePath);
  if (!existsSync(path)) {
    failures.push(`${relativePath} is missing`);
    return "";
  }
  return readFileSync(path, "utf8").replaceAll("\r\n", "\n");
}

function requireMatch(source: string, pattern: RegExp, failure: string): void {
  if (!pattern.test(source)) failures.push(failure);
}

function jobBlock(source: string, job: string, relativePath: string): string {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line === `  ${job}:`);
  if (start < 0) {
    failures.push(`${relativePath} is missing the ${job} job`);
    return "";
  }

  const next = lines.findIndex(
    (line, index) => index > start && /^  [a-zA-Z0-9_-]+:\s*$/u.test(line),
  );
  return lines.slice(start, next < 0 ? undefined : next).join("\n");
}

const verifyPath = ".github/workflows/verify.yml";
const ciPath = ".github/workflows/ci.yml";
const releasePath = ".github/workflows/release-images.yml";
const verify = readRequired(verifyPath);
const ci = readRequired(ciPath);
const release = readRequired(releasePath);

requireMatch(
  verify,
  /^on:\s*\n  workflow_call:\s*$/mu,
  `${verifyPath} must declare workflow_call`,
);
jobBlock(verify, "rust", verifyPath);
jobBlock(verify, "frontend", verifyPath);
jobBlock(verify, "production-smoke", verifyPath);

const bunPins = verify.match(/^\s+?bun-version:\s*1\.3\.14\s*$/gmu) ?? [];
if (bunPins.length !== 2) {
  failures.push(`${verifyPath} must pin Bun 1.3.14 in exactly two jobs`);
}

const reusableCall = /uses:\s*\.\/\.github\/workflows\/verify\.yml\s*$/mu;
requireMatch(ci, reusableCall, `${ciPath} must call ${verifyPath}`);
requireMatch(release, reusableCall, `${releasePath} must call ${verifyPath}`);
requireMatch(
  jobBlock(release, "publish", releasePath),
  /^    needs:\s*verify\s*$/mu,
  `${releasePath} publish must need verify`,
);
requireMatch(
  release,
  /^      - "v\*\.\*\.\*"\s*$/mu,
  `${releasePath} must retain the v*.*.* tag trigger`,
);

if (failures.length > 0) {
  console.error("Release integrity gate failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Release integrity gate passed: canonical verification blocks image publication.");
