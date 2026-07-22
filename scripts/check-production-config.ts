import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ResolvedProductionService {
  environment?: Record<string, string>;
  image?: string;
}

export interface ResolvedProductionConfig {
  services?: Record<string, ResolvedProductionService>;
  networks?: Record<
    string,
    { ipam?: { config?: Array<{ subnet?: string }> } }
  >;
}

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const productionCompose = resolve(repositoryRoot, 'infra/docker/compose.production.yml');
const placeholderPattern =
  /(?:replace[-_ ]?with|your[-_ ]?org|example\.(?:com|net|org)|changeme|change[-_ ]?me)/i;

export function validateResolvedProductionConfig(
  config: ResolvedProductionConfig,
): string[] {
  const issues: string[] = [];
  const postgres = service(config, 'postgres', issues);
  const server = service(config, 'zipshipd', issues);
  const edge = service(config, 'edge', issues);

  if (!postgres || !server || !edge) return issues;

  validateImage('postgres', postgres.image, issues);
  validateImage('zipshipd', server.image, issues);
  validateImage('edge', edge.image, issues);

  const postgresEnvironment = postgres.environment ?? {};
  const serverEnvironment = server.environment ?? {};
  const edgeEnvironment = edge.environment ?? {};

  const postgresUser = required(
    postgresEnvironment,
    'POSTGRES_USER',
    issues,
  );
  const postgresPassword = required(
    postgresEnvironment,
    'POSTGRES_PASSWORD',
    issues,
  );
  const postgresDatabase = required(
    postgresEnvironment,
    'POSTGRES_DB',
    issues,
  );
  const databaseUrl = required(
    serverEnvironment,
    'ZIPSHIP_DATABASE_URL',
    issues,
  );

  const consoleHost = required(
    edgeEnvironment,
    'ZIPSHIP_CONSOLE_HOST',
    issues,
  );
  const apiHost = required(edgeEnvironment, 'ZIPSHIP_API_HOST', issues);
  const accessHost = required(
    edgeEnvironment,
    'ZIPSHIP_ACCESS_HOST',
    issues,
  );
  const apiOrigin = required(
    edgeEnvironment,
    'ZIPSHIP_API_ORIGIN',
    issues,
  );
  const accessOrigin = required(
    edgeEnvironment,
    'ZIPSHIP_ACCESS_ORIGIN',
    issues,
  );
  const consoleOrigin = required(
    serverEnvironment,
    'ZIPSHIP_CONTROL_ALLOWED_ORIGINS',
    issues,
  );
  const consolePublicUrl = required(
    serverEnvironment,
    'ZIPSHIP_CONSOLE_PUBLIC_URL',
    issues,
  );

  for (const [key, value] of [
    ['ZIPSHIP_CONSOLE_HOST', consoleHost],
    ['ZIPSHIP_API_HOST', apiHost],
    ['ZIPSHIP_ACCESS_HOST', accessHost],
    ['ZIPSHIP_API_ORIGIN', apiOrigin],
    ['ZIPSHIP_ACCESS_ORIGIN', accessOrigin],
    ['ZIPSHIP_CONTROL_ALLOWED_ORIGINS', consoleOrigin],
    ['ZIPSHIP_CONSOLE_PUBLIC_URL', consolePublicUrl],
    ['ZIPSHIP_ACME_EMAIL', required(edgeEnvironment, 'ZIPSHIP_ACME_EMAIL', issues)],
    ['POSTGRES_PASSWORD', postgresPassword],
    ['ZIPSHIP_DATABASE_URL', databaseUrl],
    [
      'ZIPSHIP_PASSWORD_RECOVERY_KEYS',
      required(serverEnvironment, 'ZIPSHIP_PASSWORD_RECOVERY_KEYS', issues),
    ],
    ['ZIPSHIP_SMTP_URL', required(serverEnvironment, 'ZIPSHIP_SMTP_URL', issues)],
    ['ZIPSHIP_SMTP_FROM', required(serverEnvironment, 'ZIPSHIP_SMTP_FROM', issues)],
  ] as const) {
    if (value && placeholderPattern.test(value)) {
      issues.push(`${key} still contains a placeholder value`);
    }
  }

  validateHost('ZIPSHIP_CONSOLE_HOST', consoleHost, issues);
  validateHost('ZIPSHIP_API_HOST', apiHost, issues);
  validateHost('ZIPSHIP_ACCESS_HOST', accessHost, issues);
  validateOrigin('ZIPSHIP_CONTROL_ALLOWED_ORIGINS', consoleOrigin, consoleHost, issues);
  validateOrigin('ZIPSHIP_API_ORIGIN', apiOrigin, apiHost, issues);
  validateOrigin('ZIPSHIP_ACCESS_ORIGIN', accessOrigin, accessHost, issues);

  if (consoleOrigin && consolePublicUrl !== `${consoleOrigin}/`) {
    issues.push(
      'ZIPSHIP_CONSOLE_PUBLIC_URL must equal ZIPSHIP_CONTROL_ALLOWED_ORIGINS with one trailing slash',
    );
  }

  const publicHosts = [consoleHost, apiHost, accessHost].filter(Boolean);
  if (new Set(publicHosts).size !== publicHosts.length) {
    issues.push('Console, API, and Access hosts must be distinct');
  }

  validateDatabase(
    databaseUrl,
    postgresUser,
    postgresPassword,
    postgresDatabase,
    issues,
  );

  const trustedProxyNetworks = required(
    serverEnvironment,
    'ZIPSHIP_TRUSTED_PROXY_NETWORKS',
    issues,
  );
  const backendSubnet = config.networks?.backend?.ipam?.config?.[0]?.subnet;
  if (!backendSubnet) {
    issues.push('backend network must define an explicit subnet');
  } else if (trustedProxyNetworks && trustedProxyNetworks !== backendSubnet) {
    issues.push(
      'ZIPSHIP_TRUSTED_PROXY_NETWORKS must match the backend network subnet',
    );
  }

  if (serverEnvironment.ZIPSHIP_ENV !== 'production') {
    issues.push('zipshipd must run with ZIPSHIP_ENV=production');
  }

  return [...new Set(issues)];
}

function service(
  config: ResolvedProductionConfig,
  name: string,
  issues: string[],
): ResolvedProductionService | null {
  const candidate = config.services?.[name];
  if (!candidate) {
    issues.push(`missing resolved service: ${name}`);
    return null;
  }
  return candidate;
}

function required(
  environment: Record<string, string>,
  key: string,
  issues: string[],
): string {
  const value = environment[key]?.trim();
  if (!value) issues.push(`missing resolved setting: ${key}`);
  return value ?? '';
}

function validateImage(
  serviceName: string,
  image: string | undefined,
  issues: string[],
): void {
  if (!image) {
    issues.push(`${serviceName} service must resolve an image`);
    return;
  }
  const digestPinned = /@sha256:[a-f0-9]{64}$/i.test(image);
  const finalSegment = image.slice(image.lastIndexOf('/') + 1);
  const separator = finalSegment.lastIndexOf(':');
  const tag = separator >= 0 ? finalSegment.slice(separator + 1) : '';
  if (!digestPinned && (!tag || tag.toLowerCase() === 'latest')) {
    issues.push(
      `${serviceName} image must use an explicit non-latest tag or sha256 digest`,
    );
  }
  if (placeholderPattern.test(image)) {
    issues.push(`${serviceName} image still contains a placeholder value`);
  }
}

function validateHost(key: string, host: string, issues: string[]): void {
  if (!host) return;
  const valid =
    host.includes('.') &&
    !host.includes('/') &&
    !host.includes(':') &&
    /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host);
  if (!valid) issues.push(`${key} must be a DNS hostname without a scheme, port, or path`);
}

function validateOrigin(
  key: string,
  value: string,
  expectedHost: string,
  issues: string[],
): void {
  if (!value) return;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      url.origin !== value
    ) {
      issues.push(`${key} must be one canonical HTTPS origin without a trailing slash`);
    }
    if (expectedHost && url.hostname !== expectedHost) {
      issues.push(`${key} host must match ${hostKeyForOrigin(key)}`);
    }
  } catch {
    issues.push(`${key} must be a valid HTTPS origin`);
  }
}

function hostKeyForOrigin(originKey: string): string {
  if (originKey === 'ZIPSHIP_CONTROL_ALLOWED_ORIGINS') {
    return 'ZIPSHIP_CONSOLE_HOST';
  }
  return originKey.replace('_ORIGIN', '_HOST');
}

function validateDatabase(
  databaseUrl: string,
  expectedUser: string,
  expectedPassword: string,
  expectedDatabase: string,
  issues: string[],
): void {
  if (!databaseUrl) return;
  try {
    const url = new URL(databaseUrl);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
      issues.push('ZIPSHIP_DATABASE_URL must use the postgres or postgresql scheme');
    }
    if (url.hostname !== 'postgres') {
      issues.push('ZIPSHIP_DATABASE_URL host must be the bundled postgres service');
    }
    if (expectedUser && decode(url.username) !== expectedUser) {
      issues.push('ZIPSHIP_DATABASE_URL user must match POSTGRES_USER');
    }
    if (expectedPassword && decode(url.password) !== expectedPassword) {
      issues.push(
        'ZIPSHIP_DATABASE_URL password must be URL-encoded and match POSTGRES_PASSWORD',
      );
    }
    const database = decode(url.pathname.replace(/^\//, ''));
    if (expectedDatabase && database !== expectedDatabase) {
      issues.push('ZIPSHIP_DATABASE_URL database must match POSTGRES_DB');
    }
  } catch {
    issues.push('ZIPSHIP_DATABASE_URL must be a valid PostgreSQL URL');
  }
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function main(): Promise<void> {
  const environmentFile = environmentFileArgument(Bun.argv.slice(2));
  if (!environmentFile) {
    console.error(
      'Usage: bun run production:check -- --env-file /secure/path/zipship-production.env',
    );
    process.exitCode = 2;
    return;
  }

  const resolvedEnvironmentFile = resolve(process.cwd(), environmentFile);
  if (!(await Bun.file(resolvedEnvironmentFile).exists())) {
    console.error('Production configuration check failed: environment file does not exist');
    process.exitCode = 2;
    return;
  }

  let stdout: string;
  let exitCode: number;
  try {
    const child = Bun.spawn(
      [
        'docker',
        'compose',
        '--env-file',
        resolvedEnvironmentFile,
        '--file',
        productionCompose,
        'config',
        '--format',
        'json',
      ],
      {
        cwd: repositoryRoot,
        stderr: 'pipe',
        stdout: 'pipe',
      },
    );
    [stdout, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      child.exited,
    ]);
  } catch {
    console.error('Production configuration check failed: Docker Compose is unavailable');
    process.exitCode = 2;
    return;
  }

  if (exitCode !== 0) {
    console.error(
      'Production configuration check failed: Docker Compose could not resolve the production file',
    );
    process.exitCode = 1;
    return;
  }

  let config: ResolvedProductionConfig;
  try {
    config = JSON.parse(stdout) as ResolvedProductionConfig;
  } catch {
    console.error(
      'Production configuration check failed: Docker Compose returned an unreadable configuration',
    );
    process.exitCode = 1;
    return;
  }

  const issues = validateResolvedProductionConfig(config);
  if (issues.length > 0) {
    console.error('Production configuration check failed:');
    for (const issue of issues) console.error(`- ${issue}`);
    process.exitCode = 1;
    return;
  }

  console.log('Production configuration check passed.');
}

function environmentFileArgument(args: string[]): string | null {
  const inline = args.find((argument) => argument.startsWith('--env-file='));
  if (inline) return inline.slice('--env-file='.length) || null;
  const index = args.indexOf('--env-file');
  return index >= 0 ? args[index + 1] ?? null : null;
}

if (import.meta.main) await main();
