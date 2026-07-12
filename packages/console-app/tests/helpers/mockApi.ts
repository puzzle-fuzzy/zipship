import { vi } from 'vitest';

/**
 * A treaty-shaped mock for the Eden client returned by `getApi()`.
 *
 * The real client is a deep proxy: `api._api.organizations({id}).projects.get(...)`.
 * Reproducing that lets store tests call the real store code unchanged — only
 * `getApi()` is swapped out, the rest of `api/client` (token storage,
 * `authHeaders`) runs for real against jsdom storage.
 *
 * Design:
 *  - Any property access or call on a node returns the same chainable node, so
 *    arbitrary treaty paths resolve.
 *  - The five HTTP verbs (`get`/`post`/`put`/`patch`/`delete`) are distinct
 *    `vi.fn`s. A store that makes two `get`s hits the same fn twice — configure
 *    ordered responses with `mockResolvedValueOnce` in call order.
 *  - Default resolution is an empty success `{ data: null, error: null }`.
 *
 * Usage in a store test (the mock state MUST be `vi.hoisted` so the `vi.mock`
 * factory — which vitest hoists above imports — can reference it):
 *
 *   const { mockApi, setMockApi } = vi.hoisted(() => {
 *     let current: unknown = null;
 *     return { mockApi: () => current, setMockApi: (a: unknown) => { current = a; } };
 *   });
 *   vi.mock('../src/api/client', async (orig) => ({ ...(await orig()), getApi: () => mockApi() }));
 *   beforeEach(() => setMockApi(createMockApi()._api));
 */

const HTTP_VERBS = ['get', 'post', 'put', 'patch', 'delete'] as const;
export type Verb = (typeof HTTP_VERBS)[number];

export interface MockApi {
  /** The treaty root — hand this to `setMockApi`. */
  _api: unknown;
  /** Retrieve the shared `vi.fn` for a verb to assert calls or queue responses. */
  verb: (v: Verb) => ReturnType<typeof vi.fn>;
}

export function createMockApi(): MockApi {
  const verbs: Record<Verb, ReturnType<typeof vi.fn>> = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };
  for (const fn of Object.values(verbs)) {
    fn.mockResolvedValue({ data: null, error: null });
  }

  // A callable proxy (target is a function) so both `.foo` and `.foo({...})`
  // chain. Verb properties are intercepted and return the shared fn.
  const node: unknown = new Proxy(() => {}, {
    get(_target, prop: string) {
      if ((HTTP_VERBS as readonly string[]).includes(prop)) {
        return verbs[prop as Verb];
      }
      return node;
    },
    apply() {
      return node;
    },
  });

  return { _api: node, verb: (v) => verbs[v] };
}
