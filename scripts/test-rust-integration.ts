import { randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const composeFile = 'infra/docker/compose.integration.yml';
const projectName = `zipship-integration-${process.pid}-${randomBytes(4).toString('hex')}`;
const composeArgs = ['compose', '--project-name', projectName, '--file', composeFile];

let cleanupPromise: Promise<void> | undefined;

async function run(
  command: string,
  args: string[],
  options: { env?: Record<string, string | undefined>; quiet?: boolean } = {},
) {
  if (!options.quiet) {
    console.log(`> ${command} ${args.join(' ')}`);
  }
  const child = Bun.spawn([command, ...args], {
    cwd: root,
    env: options.env ?? process.env,
    stdin: 'inherit',
    stdout: options.quiet ? 'ignore' : 'inherit',
    stderr: options.quiet ? 'ignore' : 'inherit',
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`${command} exited with code ${exitCode}`);
  }
}

async function capture(command: string, args: string[]) {
  const child = Bun.spawn([command, ...args], {
    cwd: root,
    env: process.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`${command} exited with code ${exitCode}: ${stderr.trim()}`);
  }
  return stdout.trim();
}

async function publishedPort(service: string, containerPort: number) {
  const output = await capture('docker', [...composeArgs, 'port', service, String(containerPort)]);
  const match = output.match(/:(\d+)\s*$/m);
  if (!match) {
    throw new Error(`Unable to determine the published ${service} port from: ${output}`);
  }
  return Number.parseInt(match[1], 10);
}

async function waitForTcp(port: number, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const connected = await new Promise<boolean>((complete) => {
      const socket = createConnection({ host: '127.0.0.1', port });
      socket.setTimeout(500);
      socket.once('connect', () => {
        socket.destroy();
        complete(true);
      });
      const fail = () => {
        socket.destroy();
        complete(false);
      };
      socket.once('error', fail);
      socket.once('timeout', fail);
    });
    if (connected) {
      return;
    }
    await Bun.sleep(250);
  }
  throw new Error(`Timed out waiting for 127.0.0.1:${port}`);
}

async function cleanup() {
  cleanupPromise ??= run(
    'docker',
    [...composeArgs, 'down', '--volumes', '--remove-orphans'],
    { quiet: true },
  ).catch((error) => {
    console.error(`Integration environment cleanup failed: ${String(error)}`);
  });
  await cleanupPromise;
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  });
}

try {
  console.log(`Starting isolated integration environment ${projectName}`);
  await run('docker', [...composeArgs, 'up', '--detach', '--wait']);

  const [postgresPort, smtpPort] = await Promise.all([
    publishedPort('postgres', 5432),
    publishedPort('mailpit', 1025),
  ]);
  await waitForTcp(smtpPort);

  const databaseUrl = `postgres://zipship:zipship@127.0.0.1:${postgresPort}/zipship_rust_test`;
  const testEnv = {
    ...process.env,
    ZIPSHIP_DATABASE_URL: databaseUrl,
    ZIPSHIP_TEST_DATABASE_URL: databaseUrl,
    ZIPSHIP_TEST_SMTP_URL: `smtp://127.0.0.1:${smtpPort}`,
  };

  await run(
    'cargo',
    ['test', '-p', 'zipship-mail', '--test', 'smtp_mailpit', '--', '--ignored'],
    { env: testEnv },
  );
  await run(
    'cargo',
    ['test', '-p', 'zipship-postgres', '--tests', '--', '--ignored', '--test-threads=1'],
    { env: testEnv },
  );
  await run(
    'cargo',
    [
      'test',
      '-p',
      'zipship-worker',
      '--test',
      'artifact_pipeline',
      '--',
      '--ignored',
      '--test-threads=1',
    ],
    { env: testEnv },
  );

  console.log('Rust integration suite passed against isolated PostgreSQL and Mailpit services.');
} finally {
  await cleanup();
}
