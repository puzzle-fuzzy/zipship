# Vue Console Migration Design

**Date:** 2026-07-13

## Summary

ZipShip will replace the React implementation of `@zipship/console-app` with a Vue 3 application in place. The web and Tauri shells will switch in the same repository change and will continue to consume one shared console package. The finished repository will not retain a React compatibility layer, React runtime, TSX source, Zustand stores, or React test utilities.

The migration is allowed to change the visual structure and interaction details. It must preserve the product capabilities that already exist: authentication, project management, release upload and processing, preview, publish and rollback, members, project settings, audit activity, language selection, theme selection, and the Web/Tauri runtime distinction.

Less is not part of the design. Tailwind CSS v4, the existing CSS custom properties, Geist, and the `night` theme class remain the styling foundation.

## Goals

- Replace the shared React UI with Vue 3 single-file components and the Composition API.
- Switch both `apps/web-shell` and `apps/desktop-shell` to the same Vue console in one migration.
- Replace React Router with Vue Router and Zustand with Pinia setup stores.
- Use VueUse for browser state and lifecycle behavior where it removes bespoke code.
- Create a project-owned `components/ui` boundary so feature code is not coupled to a particular UI library.
- Reuse framework-independent TypeScript business logic and the typed Eden API client.
- Improve explicit dependency injection, state isolation, route restoration, loading/error states, and testability.
- Remove every React-specific source file, package, configuration entry, and test dependency after the Vue implementation is complete.

## Non-goals

- Pixel-level visual parity with the current console.
- Replacing Tailwind CSS with Less or another styling system.
- Changing backend routes, database schemas, deployment semantics, or storage behavior.
- Adding a general-purpose i18n framework when the current dictionaries and interpolation behavior are sufficient.
- Creating a permanent React/Vue bridge, micro-frontend boundary, or duplicate console package.
- Adding product features unrelated to strengthening the migrated workflows.

## Migration Strategy

The package is replaced in place. Implementation may proceed in vertical slices inside the working branch, but no intermediate React/Vue hybrid is a supported deliverable. React dependencies remain available only until all required Vue slices compile; they are removed before the migration is considered complete.

Git history remains the reference for the old implementation. A temporary `console-app-vue` package or checked-in copy of the React package will not be created.

The migration order is:

1. Update workspace, TypeScript, Vite, Turbo, lint, and test configuration for Vue files.
2. Establish Vue application creation, dependency injection, Pinia, Vue Router, authentication startup, and theme/language startup.
3. Build the project-owned UI primitives and responsive application layout.
4. Migrate project list and project creation as the first working vertical slice.
5. Migrate project details, release operations, members, deployments, settings, and audit activity.
6. Migrate the upload dialog while retaining the existing pure TypeScript upload pipeline.
7. Switch both shells, rewrite the component/store test harness, update documentation, and remove React.

## Application Bootstrap

`@zipship/console-app` will export a factory with this conceptual interface:

```ts
interface ConsoleAppOptions {
  runtime: RuntimeAdapter;
  apiBaseUrl: string;
}

function createConsoleApp(options: ConsoleAppOptions): App;
```

Each shell obtains its runtime adapter and API base URL, calls the factory, and mounts the returned Vue application. The factory creates a fresh Pinia instance, router instance, API service container, and application error handler. Fresh instances are required so unit tests, browser mounts, and future embedded contexts do not share module-level state.

The API base URL and runtime adapter are provided through typed Vue injection keys. Rendering a component must never mutate `window.__ZIPSHIP_API_BASE_URL`. The console will use the existing `@zipship/api-client` factory as the single source of the Eden Treaty client rather than constructing another Treaty client inside the UI package.

`App.vue` owns only application-level concerns:

- session and settings initialization;
- loading, login, and authenticated application gates;
- the router view;
- the global toast host;
- the top-level render error boundary.

## Source Boundaries

The Vue console keeps the existing feature-oriented layout, with these responsibilities:

- `app/`: application factory, injection keys, router, and global error handling.
- `pages/`: route-level composition and page-specific loading/error states.
- `features/`: cohesive product workflows such as upload, release deployment, members, and settings.
- `stores/`: Pinia setup stores for authentication, projects, members, audit records, and settings.
- `composables/`: reusable Vue behavior such as translation, release polling, responsive state, and clipboard actions.
- `components/ui/`: project-owned primitives and library adapters.
- `api/`: typed service access and stable API error mapping.
- framework-independent `.ts` modules: upload pipeline, release status/reporting, settings models, permissions, URL generation, validation, and translation dictionaries.

Pages and features may import project UI primitives. They may not import Reka UI or a future third-party component library directly. UI primitives may use headless Reka UI behavior internally for dialogs, dropdowns, selects, tabs, tooltips, and other interactions where focus and keyboard accessibility are difficult to implement correctly.

This boundary allows a future component library to replace or supplement primitives without rewriting product pages.

## State and VueUse

Pinia setup stores own shared business state and asynchronous actions. They preserve explicit status and error state rather than exposing only data arrays. Store actions use the injected API services and remain testable with fresh Pinia instances.

VueUse complements Pinia rather than replacing it:

- `useSessionStorage` stores the refresh token under the existing key.
- `useLocalStorage` stores theme and language preferences.
- `useMediaQuery` or `useBreakpoints` drives responsive navigation.
- visibility-aware polling utilities drive release discovery after uploads and pause unnecessary background requests.
- `useFileDialog` and `useDropZone` support ZIP, folder, and single-HTML selection.
- `useClipboard` handles invitation and preview/production URL copying.
- `useEventListener` owns keyboard and window event cleanup.
- `useOnline` may expose an actionable offline state during upload and retryable requests.

The five existing Zustand stores become Pinia stores. Short-lived state such as the currently expanded release, an open confirmation dialog, or form draft values remains local to the owning page or feature component.

## Routing and Layout

The following compatibility routes remain valid:

- `/app/projects`
- `/app/projects/:projectId`
- `/app/logs`
- `/app/storage`

Project details gain nested, linkable routes:

- `/app/projects/:projectId/versions`
- `/app/projects/:projectId/members`
- `/app/projects/:projectId/deployments`
- `/app/projects/:projectId/settings`
- `/app/projects/:projectId/activity`

`/app/projects/:projectId` redirects to the versions child route. Unknown routes redirect to `/app`. The route is the source of truth for the active project-detail section so reload and browser navigation restore the current view.

The application layout is rebuilt for Vue instead of reproducing the React sidebar implementation. Desktop navigation may remain visible while compact viewports use a drawer. Router links replace full-page anchor navigation for internal destinations.

## Primary Data Flows

### Authentication

Startup reads the existing session token and calls the authenticated user endpoint. An invalid or revoked token is removed before entering the login state. Login and registration derive `clientType` from the injected runtime, including desktop registration. Logout calls the backend revocation endpoint before clearing local state; local state is still cleared if the network request cannot complete, while the user receives an appropriate warning.

### Project list

The project store exposes loading, loaded, empty, and error states plus a retry action. Creating a project updates the store and routes to the created project without requiring a full page reload.

### Project details

Entering a detail route loads the project and its releases, members, deployments, and audit activity. Independent requests may run concurrently and expose section-level errors where possible. A route parameter change invalidates page-local state before loading the next project so data cannot leak between projects.

Permissions are derived from membership and used to produce explicit read-only, hidden, or enabled controls. Permission checks are not left to disabled styling alone; mutation actions also guard before calling the API.

### Upload and release discovery

The existing ZIP, folder, and single-HTML modes remain. The pure TypeScript `uploadPipeline` and `uploadDialogModel` stay responsible for validation, packaging, and the three-step API sequence. Vue components provide file selection, drag-and-drop, progress, cancellation-safe UI state, and recoverable errors.

After completion, release polling looks for a new release relative to the prior latest release. It keeps the existing bounded retry behavior, pauses when the document is hidden, resumes when visible, and stops on success, terminal error, route change, or component unmount. A discovered release opens the versions route and highlights the result.

### Publish, rollback, settings, and members

Publish and rollback retain confirmation and failed-release risk gates. Destructive project settings require explicit confirmation and navigate away only after successful deletion. Member invitation, role management, and removal reflect permissions and surface stable error messages. Copy operations use the shared clipboard composable and provide toast feedback.

## Error Handling

API services and stores continue to map stable backend error codes into user-facing localized messages. Components do not interpret raw Eden response shapes or duplicate code maps.

Each route and major section has distinct loading, empty, error, and retry states. Mutation errors remain close to the action that failed and may also produce a toast. Form validation is shown inline. Unknown render failures are captured by a Vue error boundary and the application error handler without exposing sensitive request data.

Polling, clipboard, file access, and storage APIs account for unsupported browser capabilities. The Tauri shell uses the same product components through the `RuntimeAdapter`; native-only behavior remains behind the runtime boundary.

## Styling and UI Libraries

Tailwind CSS v4 and the existing CSS variable tokens remain. The `night` class continues to activate the dark theme. Vue templates use `class` bindings and project primitives; the migration does not introduce Less.

The design may simplify or reorganize current screens. It must remain compact and operational, preserve responsive behavior, handle text overflow, and show permission/loading/error states. Visual snapshots of the React UI are references for product coverage, not acceptance baselines.

The component-library policy is:

1. Product pages import only from project-owned UI paths.
2. Library-specific props and events are adapted inside those components.
3. Domain terminology does not enter generic UI primitives.
4. A future library can coexist behind the same boundary while features migrate deliberately.

## Testing

Vitest remains the test runner. Framework-independent tests are retained with minimal changes. Component tests move to `@testing-library/vue`; they use a fresh Pinia instance, a memory router, and injected mock API services. Tests prefer user-visible roles, labels, and state transitions over library-specific DOM structure or snapshots.

Coverage includes:

- session restoration, login, registration, runtime-specific client type, logout, and failed revocation;
- project loading, creation, retry, route transitions, and state isolation;
- nested detail routing and restoration;
- upload selection, packaging handoff, processing feedback, bounded polling, visibility changes, and new-release highlighting;
- publish, rollback, destructive confirmations, permission/read-only states, and API error mapping;
- member and audit flows;
- theme and language persistence;
- dialog, select, dropdown, and drawer keyboard/focus behavior.

Static verification uses `vue-tsc` for every Vue workspace. The console tests, Web typecheck/build, desktop renderer typecheck/build, workspace typecheck, lint, and unit tests must pass. Browser smoke testing covers authentication, project navigation, upload, publish/rollback, settings, language/theme changes, and compact navigation.

Full database-backed tests require Docker PostgreSQL. A native Tauri build requires the Rust/WebView toolchain. Missing external tooling is reported separately from code failures; all verifications supported by the environment still run.

## Repository Configuration and Documentation

- Root catalogs replace React packages with Vue, Vue Router, Pinia, VueUse, the Vue Vite plugin, Vue type checking, Vue icons, toast support, and any headless UI dependency used by the adapter layer.
- Console, Web, and desktop Vite configurations use the Vue plugin.
- TypeScript paths point to `src/index.ts`; workspace typechecks include Vue SFCs through `vue-tsc`.
- Turbo inputs include `.vue`, `.ts`, `.css`, configuration files, and shell `index.html` files so cache invalidation is correct.
- Oxlint configuration removes React rules and includes Vue files.
- React shadcn configuration is replaced with configuration appropriate to the project-owned Vue UI directory, or removed if it no longer provides value.
- `AGENTS.md`, README material, and other architecture documentation identify Vue, Pinia, VueUse, Vue Router, and Vue UI conventions as the frontend defaults.

## Definition of Done

The migration is complete only when:

- Web and Tauri renderer builds consume the Vue `@zipship/console-app`.
- Existing product workflows listed in this design are operational.
- Vue component, store, and retained pure TypeScript tests pass.
- Workspace typecheck, lint, console tests, and both shell builds pass in the available environment.
- Browser smoke tests pass for the critical workflows.
- No source or test `.tsx` files remain.
- No React, React DOM, React Router, Zustand, React Testing Library, React icon, React Vite plugin, Base UI React, or React Radix dependencies remain.
- No `window.__ZIPSHIP_API_BASE_URL` dependency or duplicate console Treaty client remains.
- Repository documentation and build-cache inputs describe the Vue architecture.
