# ZipShip Desktop

The Tauri shell hosts the shared `@zipship/console-app` renderer and delegates
external HTTP(S) links to the operating system through a narrow opener
capability. It does not embed a second API or database implementation.

The local shell defaults to the Rust development listeners:

```text
VITE_ZIPSHIP_API_BASE_URL=http://localhost:5006
VITE_ZIPSHIP_ACCESS_BASE_URL=http://localhost:5007
```

Start the Rust services first, then launch the native shell:

```bash
bun run infra:up
bun run db:migrate
bun run dev:api
bun run dev:worker
bun run desktop:dev
```

Build the native executable without an installer bundle:

```bash
bun run desktop:build
```

The currently validated native target is Windows x86_64. The Tauri lockfile
also records target-specific Linux GTK3 dependencies; they are not part of the
Windows build graph, but upstream has marked that GTK3 binding generation as
unmaintained and its `glib` 0.18 line has a RustSec unsoundness advisory.
Do not publish a Linux Desktop build until the Tauri Linux dependency path has
moved to a maintained, patched stack and has its own native smoke evidence.

The production shell CSP permits configured HTTP(S) Control and Access Plane
origins, while scripts remain local-only. Public deployment URLs are build-time
settings; the Web Console remains the canonical zero-install production client.
