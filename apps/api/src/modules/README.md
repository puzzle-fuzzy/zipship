# API modules

Every domain lives under `apps/api/src/modules/:feature/`. There are two kinds:

## HTTP modules

Expose routes. Files:

- `index.ts` — Elysia plugin (controller). Exports a named factory
  `xxxModule(options)` that returns an `Elysia` instance.
- `model.ts` — TypeBox (`t.Object`) validation schemas, derived types, error
  classes.
- `service.ts` — Business logic class. Receives repository interfaces, hash
  functions, clock via constructor. **Never** touches the HTTP context.
- `drizzle-repository.ts` — Drizzle implementation of the repository interface.

Examples: `auth`, `projects`, `deployments`, `uploads`, `members`, `invitations`,
`organizations`, `releases`, `site-preview`.

## Internal modules

No HTTP routes — pure services consumed by other modules. Still ship an
`index.ts` barrel for consistency:

- `index.ts` — re-exports the service, repository interface, and drizzle factory.
- `service.ts` — the service + its repository interface.
- `drizzle-repository.ts` — drizzle implementation (if it owns persistence).

Examples: `audit`, `release-processing`, `email`, `permissions`.

## Conventions

- Services return success **or** a typed error object (never throw for expected
  domain failures). Controllers map errors to HTTP status codes; responses carry
  only stable `code` strings, never user-facing text.
- Repositories return `T | null` for lookups; services decide which error code
  `null` maps to.
- Cross-module helpers belong in `apps/api/src/lib/` (`auth.ts`, `normalize.ts`,
  `logger.ts`) — don't redefine them per module.
