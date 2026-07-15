export interface ZipShipRuntimeConfig {
  apiBaseUrl?: string;
  accessBaseUrl?: string;
}

interface ResolveWebShellConfigOptions {
  buildAccessBaseUrl?: string;
  buildApiBaseUrl?: string;
  development: boolean;
  runtime?: ZipShipRuntimeConfig;
}

export interface WebShellConfig {
  apiBaseUrl: string;
  accessBaseUrl: string;
}

export function resolveWebShellConfig({
  buildAccessBaseUrl,
  buildApiBaseUrl,
  development,
  runtime,
}: ResolveWebShellConfigOptions): WebShellConfig {
  return {
    apiBaseUrl: publicOrigin(
      runtime?.apiBaseUrl ?? buildApiBaseUrl,
      development ? 'http://localhost:5006' : undefined,
      'API',
    ),
    accessBaseUrl: publicOrigin(
      runtime?.accessBaseUrl ?? buildAccessBaseUrl,
      development ? 'http://localhost:5007' : undefined,
      'Access Plane',
    ),
  };
}

function publicOrigin(value: string | undefined, fallback: string | undefined, label: string) {
  const candidate = value?.trim() || fallback;
  if (!candidate) {
    throw new Error(`${label} public origin is not configured.`);
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`${label} public origin is not a valid URL.`);
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${label} public origin must be an HTTP(S) origin without credentials or a path.`);
  }

  return url.origin;
}
