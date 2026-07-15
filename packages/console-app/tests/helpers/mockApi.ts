import { vi } from 'vitest';

const HTTP_VERBS = ['get', 'post', 'put', 'patch', 'delete'] as const;
export type Verb = (typeof HTTP_VERBS)[number];

export interface MockApi {
  /** OpenAPI client root handed to the mocked `getApi()`. */
  _api: unknown;
  /** Retrieve one OpenAPI HTTP method mock. */
  verb: (verb: Verb) => ReturnType<typeof vi.fn>;
}

/** A small openapi-fetch-shaped client used by Console store tests. */
export function createMockApi(): MockApi {
  const verbs = Object.fromEntries(
    HTTP_VERBS.map((verb) => [verb, vi.fn().mockResolvedValue({ data: undefined, error: undefined })]),
  ) as Record<Verb, ReturnType<typeof vi.fn>>;

  return {
    _api: {
      GET: verbs.get,
      POST: verbs.post,
      PUT: verbs.put,
      PATCH: verbs.patch,
      DELETE: verbs.delete,
    },
    verb: (verb) => verbs[verb],
  };
}
