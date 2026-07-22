import JSZip from 'jszip';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const productionCompose = 'infra/docker/compose.production.yml';
const smokeCompose = 'infra/docker/compose.smoke.yml';

type CommandResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

type SmokeRequest = {
  body?: unknown;
  headers?: Record<string, string>;
  host: string;
  method?: string;
  path: string;
  uploadFile?: string;
};

type SmokeResponse = {
  body: string;
  status: number;
};

async function runCapture(command: string[]): Promise<CommandResult> {
  const child = Bun.spawn(command, {
    cwd: repositoryRoot,
    env: process.env,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stderr, stdout };
}

async function run(command: string[], allowFailure = false): Promise<void> {
  const child = Bun.spawn(command, {
    cwd: repositoryRoot,
    env: process.env,
    stderr: 'inherit',
    stdout: 'inherit',
  });
  const exitCode = await child.exited;
  if (exitCode !== 0 && !allowFailure) {
    throw new Error(`Command failed with exit code ${exitCode}: ${command.join(' ')}`);
  }
}

function randomIdentifier(bytes = 6): string {
  return randomBytes(bytes).toString('hex');
}

async function availablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Unable to reserve a local smoke-test port'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function encodeEnvironment(entries: Record<string, string>): string {
  return Object.entries(entries)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join('\n') + '\n';
}

async function main(): Promise<void> {
  const workingDirectory = await mkdtemp(join(tmpdir(), 'zipship-production-smoke-'));
  const environmentFile = join(workingDirectory, 'production.env');
  const archiveFile = join(workingDirectory, 'site.zip');
  const runId = randomIdentifier();
  const projectName = `zipship-smoke-${runId}`;
  const httpPort = await availablePort();
  const httpsPort = await availablePort();
  const subnetOctet = 128 + (randomBytes(1)[0] % 96);
  const consoleHost = 'console.zipship.test';
  const apiHost = 'api.zipship.test';
  const accessHost = 'sites.zipship.test';
  const consoleOrigin = `https://${consoleHost}:${httpsPort}`;
  const apiOrigin = `https://${apiHost}:${httpsPort}`;
  const accessOrigin = `https://${accessHost}:${httpsPort}`;
  const postgresPassword = `smoke_${randomIdentifier(16)}`;
  const recoveryKey = randomBytes(32).toString('base64url');

  const compose = (...args: string[]) => [
    'docker',
    'compose',
    '--progress',
    'quiet',
    '--project-name',
    projectName,
    '--env-file',
    environmentFile,
    '--file',
    productionCompose,
    '--file',
    smokeCompose,
    ...args,
  ];

  await writeFile(
    environmentFile,
    encodeEnvironment({
      ZIPSHIP_ACCESS_HOST: accessHost,
      ZIPSHIP_ACCESS_ORIGIN: accessOrigin,
      ZIPSHIP_ACME_EMAIL: 'smoke@example.invalid',
      ZIPSHIP_API_HOST: apiHost,
      ZIPSHIP_API_ORIGIN: apiOrigin,
      ZIPSHIP_BACKEND_SUBNET: `172.31.${subnetOctet}.0/24`,
      ZIPSHIP_CONSOLE_HOST: consoleHost,
      ZIPSHIP_CONSOLE_ORIGIN: consoleOrigin,
      ZIPSHIP_DATABASE_URL: `postgres://zipship:${postgresPassword}@postgres:5432/zipship`,
      ZIPSHIP_EDGE_IMAGE: 'zipship/edge:smoke',
      ZIPSHIP_HTTP_PORT: String(httpPort),
      ZIPSHIP_HTTPS_PORT: String(httpsPort),
      ZIPSHIP_LOG: 'warn,sqlx=warn',
      ZIPSHIP_PASSWORD_RECOVERY_ACTIVE_KEY_ID: 'smoke',
      ZIPSHIP_PASSWORD_RECOVERY_KEYS: `smoke:${recoveryKey}`,
      ZIPSHIP_POSTGRES_DB: 'zipship',
      ZIPSHIP_POSTGRES_IMAGE:
        process.env.ZIPSHIP_SMOKE_POSTGRES_IMAGE ?? 'postgres:17.6-bookworm',
      ZIPSHIP_POSTGRES_PASSWORD: postgresPassword,
      ZIPSHIP_POSTGRES_USER: 'zipship',
      ZIPSHIP_SERVER_IMAGE: 'zipship/server:smoke',
      ZIPSHIP_SMTP_FROM: 'ZipShip Smoke <security@example.invalid>',
      ZIPSHIP_SMTP_URL: 'smtps://smtp.invalid:465',
      ZIPSHIP_WORKER_POLL_MS: '100',
      ZIPSHIP_WORKER_SWEEP_SECS: '2',
    }),
    'utf8',
  );

  let composeAttempted = false;
  try {
    for (const command of [['docker', 'info', '--format', '{{.ServerVersion}}']]) {
      const result = await runCapture(command);
      if (result.exitCode !== 0 || !result.stdout.trim()) {
        const detail = result.stderr.trim() || 'command returned no version information';
        throw new Error(`${command[0]} is unavailable: ${detail}`);
      }
    }

    await run([
      'bun',
      'scripts/check-production-config.ts',
      '--env-file',
      environmentFile,
    ]);
    await run(compose('config', '--quiet'));
    composeAttempted = true;
    console.log(`Starting isolated production stack ${projectName}...`);
    await run(compose('up', '--detach', '--build', '--wait', '--wait-timeout', '600'));

    const request = createSmokeClient({
      apiHost,
      consoleOrigin,
      httpsPort,
    });

    await request({ host: apiHost, path: '/_health/ready' });
    const consolePage = await request({ host: consoleHost, path: '/' });
    if (!consolePage.body.toLowerCase().includes('<!doctype html>')) {
      throw new Error('Console edge endpoint did not return the built application shell');
    }
    const runtimeConfig = await request({
      host: consoleHost,
      path: '/runtime-config.js',
    });
    if (
      !runtimeConfig.body.includes(apiOrigin) ||
      !runtimeConfig.body.includes(accessOrigin) ||
      runtimeConfig.body.includes('localhost')
    ) {
      throw new Error('Console runtime config did not expose the deployment public origins');
    }

    const email = `smoke-${runId}@example.test`;
    await request.json('POST', '/_api/auth/register', {
      displayName: 'Production Smoke',
      email,
      password: `Smoke-${randomIdentifier(12)}-aA9!`,
    });
    const csrfToken = request.cookie('zipship_csrf');

    const organizations = await request.json<{
      organizations: Array<{ id: string }>;
    }>('GET', '/_api/organizations');
    const organizationId = organizations.organizations[0]?.id;
    if (!organizationId) {
      throw new Error('Registration did not create an owner organization');
    }

    const slug = `smoke-${runId}`;
    const project = await request.json<{ project: { id: string } }>(
      'POST',
      `/_api/organizations/${organizationId}/projects`,
      { description: 'Production distribution smoke test', name: 'Smoke Site', slug },
      { 'x-csrf-token': csrfToken },
    );
    const projectId = project.project.id;

    const marker = `zipship-production-smoke-${runId}`;
    const archive = new JSZip();
    archive.file(
      'index.html',
      `<!doctype html><html><body><main id="marker">${marker}</main></body></html>`,
    );
    archive.file('assets/app.js', `globalThis.__ZIPSHIP_SMOKE__ = '${marker}';`);
    const bytes = await archive.generateAsync({
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
      type: 'uint8array',
    });
    await Bun.write(archiveFile, bytes);

    const reservation = await request.json<{ upload: { id: string } }>(
      'POST',
      `/_api/projects/${projectId}/uploads`,
      { filename: 'site.zip', sizeBytes: bytes.byteLength },
      { 'x-csrf-token': csrfToken },
    );
    const uploadId = reservation.upload.id;

    await request({
      headers: {
        'content-type': 'application/zip',
        'x-csrf-token': csrfToken,
      },
      host: apiHost,
      path: `/_api/uploads/${uploadId}/content`,
      uploadFile: archiveFile,
    });
    const finalized = await request.json<{ releaseId: string }>(
      'POST',
      `/_api/uploads/${uploadId}/complete`,
      undefined,
      { 'x-csrf-token': csrfToken },
    );
    const releaseId = finalized.releaseId;

    await waitForRelease(request.json, projectId, releaseId);
    const deployment = await request.json<{ activeReleaseId: string }>(
      'POST',
      `/_api/projects/${projectId}/releases/${releaseId}/publish`,
      { message: 'Production smoke publish' },
      {
        'idempotency-key': `smoke-publish-${runId}`,
        'x-csrf-token': csrfToken,
      },
    );
    if (deployment.activeReleaseId !== releaseId) {
      throw new Error('Publish response did not activate the processed release');
    }

    const preview = await request({
      host: accessHost,
      path: `/_sites/${slug}/${releaseId}/`,
    });
    const live = await request({ host: accessHost, path: `/${slug}/` });
    if (!preview.body.includes(marker) || !live.body.includes(marker)) {
      throw new Error('Access Plane did not serve the immutable preview and active release');
    }

    console.log(
      `Production smoke passed: register -> project -> upload -> worker -> publish -> preview/live (${marker})`,
    );
  } catch (error) {
    if (composeAttempted) {
      await run(compose('ps', '--all'), true);
      await run(compose('logs', '--no-color', '--tail', '300'), true);
    }
    throw error;
  } finally {
    if (composeAttempted) {
      await run(compose('down', '--volumes', '--remove-orphans', '--timeout', '30'), true);
    }
    await rm(workingDirectory, { force: true, recursive: true });
  }
}

function createSmokeClient(options: {
  apiHost: string;
  consoleOrigin: string;
  httpsPort: number;
}) {
  const cookies = new Map<string, Map<string, string>>();

  const request = async ({
    body,
    headers = {},
    host,
    method = 'GET',
    path,
    uploadFile,
  }: SmokeRequest): Promise<SmokeResponse> => {
    const effectiveMethod = uploadFile ? 'PUT' : method;
    const hostCookies = cookies.get(host);
    const requestHeaders: Record<string, string> = {
      host,
      origin: options.consoleOrigin,
      ...headers,
    };
    if (hostCookies?.size) {
      requestHeaders.cookie = [...hostCookies]
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');
    }

    let payload: Buffer | string | undefined;
    if (uploadFile) {
      payload = await readFile(uploadFile);
    } else if (body !== undefined) {
      requestHeaders['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    const response = await new Promise<SmokeResponse>((resolve, reject) => {
      const outgoing = httpsRequest(
        {
          headers: requestHeaders,
          hostname: '127.0.0.1',
          method: effectiveMethod,
          path,
          port: options.httpsPort,
          rejectUnauthorized: false,
          servername: host,
        },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          incoming.on('end', () => {
            rememberCookies(cookies, host, incoming.headers['set-cookie']);
            resolve({
              body: Buffer.concat(chunks).toString('utf8'),
              status: incoming.statusCode ?? 0,
            });
          });
          incoming.on('error', reject);
        },
      );
      outgoing.setTimeout(60_000, () => {
        outgoing.destroy(new Error(`${effectiveMethod} ${host}${path} timed out`));
      });
      outgoing.on('error', reject);
      outgoing.end(payload);
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `${effectiveMethod} https://${host}:${options.httpsPort}${path} failed (${response.status}): ${response.body}`,
      );
    }
    return response;
  };

  request.json = async <T>(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> => {
    const response = await request({
      body,
      headers,
      host: options.apiHost,
      method,
      path,
    });
    return JSON.parse(response.body) as T;
  };

  request.cookie = (name: string): string => {
    for (const hostCookies of cookies.values()) {
      const value = hostCookies.get(name);
      if (value) {
        return value;
      }
    }
    throw new Error(`Cookie ${name} was not issued`);
  };

  return request;
}

function rememberCookies(
  cookies: Map<string, Map<string, string>>,
  host: string,
  setCookieHeaders: string[] | undefined,
): void {
  if (!setCookieHeaders?.length) {
    return;
  }

  const hostCookies = cookies.get(host) ?? new Map<string, string>();
  for (const header of setCookieHeaders) {
    const pair = header.split(';', 1)[0];
    const separator = pair.indexOf('=');
    if (separator > 0) {
      hostCookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }
  cookies.set(host, hostCookies);
}

type SmokeClient = ReturnType<typeof createSmokeClient>;

async function waitForRelease(
  json: SmokeClient['json'],
  projectId: string,
  releaseId: string,
): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await json<{
      releases: Array<{ failureCode: string | null; id: string; state: string }>;
    }>('GET', `/_api/projects/${projectId}/releases`);
    const release = response.releases.find((candidate) => candidate.id === releaseId);
    if (release?.state === 'ready') {
      return;
    }
    if (release?.state === 'failed') {
      throw new Error(`Artifact worker failed release ${releaseId}: ${release.failureCode}`);
    }
    await Bun.sleep(500);
  }
  throw new Error(`Artifact worker did not make release ${releaseId} ready within 60 seconds`);
}

await main();
