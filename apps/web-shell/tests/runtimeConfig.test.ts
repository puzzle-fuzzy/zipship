import { describe, expect, it } from 'bun:test';
import { resolveWebShellConfig } from '../src/runtimeConfig';

describe('web shell runtime config', () => {
  it('prefers startup-injected public origins', () => {
    expect(
      resolveWebShellConfig({
        buildApiBaseUrl: 'https://build-api.example.com',
        buildAccessBaseUrl: 'https://build-sites.example.com',
        development: false,
        runtime: {
          apiBaseUrl: 'https://api.example.com',
          accessBaseUrl: 'https://sites.example.com',
        },
      }),
    ).toEqual({
      apiBaseUrl: 'https://api.example.com',
      accessBaseUrl: 'https://sites.example.com',
    });
  });

  it('uses localhost defaults only during development', () => {
    expect(resolveWebShellConfig({ development: true })).toEqual({
      apiBaseUrl: 'http://localhost:5006',
      accessBaseUrl: 'http://localhost:5007',
    });
    expect(() => resolveWebShellConfig({ development: false })).toThrow(
      'API public origin is not configured.',
    );
  });

  it('rejects credentials, paths, and non-http schemes', () => {
    for (const apiBaseUrl of [
      'https://user@example.com',
      'https://api.example.com/v1',
      'javascript:alert(1)',
    ]) {
      expect(() =>
        resolveWebShellConfig({
          development: false,
          runtime: {
            apiBaseUrl,
            accessBaseUrl: 'https://sites.example.com',
          },
        }),
      ).toThrow();
    }
  });

  it('normalizes a trailing origin slash', () => {
    expect(
      resolveWebShellConfig({
        development: false,
        runtime: {
          apiBaseUrl: 'https://api.example.com/',
          accessBaseUrl: 'https://sites.example.com/',
        },
      }),
    ).toEqual({
      apiBaseUrl: 'https://api.example.com',
      accessBaseUrl: 'https://sites.example.com',
    });
  });
});
