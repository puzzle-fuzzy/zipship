import { describe, expect, test } from 'bun:test';
import {
  validateResolvedProductionConfig,
  type ResolvedProductionConfig,
} from './check-production-config';

function validConfig(): ResolvedProductionConfig {
  const postgresPassword = 'correct-horse-battery-staple';
  return {
    services: {
      postgres: {
        image: 'postgres:17.6-bookworm',
        environment: {
          POSTGRES_DB: 'zipship',
          POSTGRES_PASSWORD: postgresPassword,
          POSTGRES_USER: 'zipship',
        },
      },
      zipshipd: {
        image: 'ghcr.io/acme/zipship-server:0.2.0',
        environment: {
          ZIPSHIP_CONSOLE_PUBLIC_URL: 'https://console.acme.test/',
          ZIPSHIP_CONTROL_ALLOWED_ORIGINS: 'https://console.acme.test',
          ZIPSHIP_DATABASE_URL: `postgres://zipship:${postgresPassword}@postgres:5432/zipship`,
          ZIPSHIP_ENV: 'production',
          ZIPSHIP_PASSWORD_RECOVERY_ACTIVE_KEY_ID: 'production-2026-07',
          ZIPSHIP_PASSWORD_RECOVERY_KEYS:
            'production-2026-07:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          ZIPSHIP_SMTP_FROM: 'ZipShip <security@acme.test>',
          ZIPSHIP_SMTP_URL: 'smtps://smtp-user:smtp-password@smtp.acme.test:465',
          ZIPSHIP_TRUSTED_PROXY_NETWORKS: '172.30.0.0/24',
        },
      },
      edge: {
        image: 'ghcr.io/acme/zipship-edge:0.2.0',
        environment: {
          ZIPSHIP_ACCESS_HOST: 'sites.acme.test',
          ZIPSHIP_ACCESS_ORIGIN: 'https://sites.acme.test',
          ZIPSHIP_ACME_EMAIL: 'operations@acme.test',
          ZIPSHIP_API_HOST: 'api.acme.test',
          ZIPSHIP_API_ORIGIN: 'https://api.acme.test',
          ZIPSHIP_CONSOLE_HOST: 'console.acme.test',
        },
      },
    },
    networks: {
      backend: {
        ipam: { config: [{ subnet: '172.30.0.0/24' }] },
      },
    },
  };
}

describe('production configuration preflight', () => {
  test('accepts a resolved production configuration with aligned boundaries', () => {
    expect(validateResolvedProductionConfig(validConfig())).toEqual([]);
  });

  test('rejects placeholders and moving image tags', () => {
    const config = validConfig();
    config.services!.edge!.image = 'ghcr.io/your-org/zipship-edge:latest';
    config.services!.edge!.environment!.ZIPSHIP_CONSOLE_HOST = 'console.example.com';
    config.services!.zipshipd!.environment!.ZIPSHIP_PASSWORD_RECOVERY_KEYS =
      'production:replace-with-43-character-base64url-key';

    const issues = validateResolvedProductionConfig(config);

    expect(issues).toContain('edge image must use an explicit non-latest tag or sha256 digest');
    expect(issues).toContain('ZIPSHIP_CONSOLE_HOST still contains a placeholder value');
    expect(issues).toContain('ZIPSHIP_PASSWORD_RECOVERY_KEYS still contains a placeholder value');
  });

  test('rejects mismatched public, database, and proxy boundaries without leaking secrets', () => {
    const config = validConfig();
    config.services!.edge!.environment!.ZIPSHIP_API_ORIGIN = 'https://wrong.acme.test';
    config.services!.zipshipd!.environment!.ZIPSHIP_DATABASE_URL =
      'postgres://other:super-secret@postgres:5432/wrong';
    config.services!.zipshipd!.environment!.ZIPSHIP_TRUSTED_PROXY_NETWORKS = '10.0.0.0/8';

    const issues = validateResolvedProductionConfig(config);
    const report = issues.join('\n');

    expect(report).toContain('ZIPSHIP_API_ORIGIN host must match ZIPSHIP_API_HOST');
    expect(report).toContain('ZIPSHIP_DATABASE_URL user must match POSTGRES_USER');
    expect(report).toContain('ZIPSHIP_DATABASE_URL database must match POSTGRES_DB');
    expect(report).toContain('ZIPSHIP_TRUSTED_PROXY_NETWORKS must match the backend network subnet');
    expect(report).not.toContain('super-secret');
  });

  test('reports missing services and settings instead of throwing', () => {
    const issues = validateResolvedProductionConfig({ services: {} });

    expect(issues).toContain('missing resolved service: postgres');
    expect(issues).toContain('missing resolved service: zipshipd');
    expect(issues).toContain('missing resolved service: edge');
  });
});
