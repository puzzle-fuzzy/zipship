# Vue Console Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shared React console with a Vue 3 application in place, switch both Web and Tauri shells, preserve all existing product workflows, and remove the React toolchain completely.

**Architecture:** `@zipship/console-app` becomes a Vue application factory that creates isolated Pinia, Vue Router, API, runtime, and session contexts. Product pages depend on Pinia stores, VueUse composables, framework-independent domain modules, and project-owned UI adapters; library-specific UI code stays inside `components/ui`.

**Tech Stack:** Bun workspaces, Vue 3 SFC, Vue Router, Pinia, VueUse, Reka UI, Tailwind CSS v4, Lucide Vue, Vue Sonner, Eden Treaty, Vitest, Testing Library Vue, vue-tsc, Vite, Tauri.

## Global Constraints

- Replace `packages/console-app` in place; do not create a second checked-in console package or a permanent React/Vue bridge.
- Web and Tauri renderer must consume the same Vue console in the final change.
- Use Vue 3 single-file components and the Composition API; final source and tests contain no TSX.
- Use Pinia for shared business state and VueUse for browser storage, media queries, polling, file selection, drop zones, clipboard, visibility, online state, and event cleanup.
- Retain Tailwind CSS v4, the existing CSS custom properties, Geist, and the `html.night` theme contract. Do not add Less.
- Product pages import only project-owned components from `components/ui`; Reka UI or future UI libraries may be imported only by that adapter layer.
- Reuse the existing typed `@zipship/api-client` and framework-independent upload, release, permission, URL, validation, and i18n modules.
- Do not change backend routes, database schemas, deployment semantics, or storage behavior.
- Preserve authentication, projects, ZIP/folder/HTML upload, preview, publish, rollback, members, settings, audit activity, language, theme, and Web/Tauri runtime behavior.
- Every request-driven view has explicit loading, empty, error, and retry behavior. Mutation failures stay actionable and use stable backend error codes.
- Keep existing formatting conventions. Use `unknown` plus narrowing instead of `any` at new boundaries.
- Use Python scripts for repository-wide inspection on Windows when shell encoding could affect output.
- Run the narrow test after each behavior change, then the package typecheck/test. Do not remove React dependencies until the Vue application and rewritten tests pass.

---

### Task 1: Add the Incremental Vue Toolchain and Test Harness

**Files:**
- Modify: `package.json`
- Modify: `turbo.json`
- Modify: `tsconfig.base.json`
- Modify: `.oxlintrc.json`
- Modify: `packages/console-app/package.json`
- Modify: `packages/console-app/tsconfig.json`
- Modify: `packages/console-app/vite.config.ts`
- Modify: `packages/console-app/src/env.d.ts`
- Modify: `packages/console-app/tests/setup.ts`
- Create: `packages/console-app/tests/fixtures/VueProbe.vue`
- Create: `packages/console-app/tests/vue-toolchain.test.ts`
- Modify: `bun.lock`

**Interfaces:**
- Produces: Vite/Vitest can compile `.vue` files while the old React tests remain runnable during the working branch.
- Produces: `bun --filter @zipship/console-app typecheck` checks `.ts`, temporary `.tsx`, and `.vue` sources until final cleanup.
- Produces: Turbo invalidates on `.vue`, `.css`, shell HTML, and relevant configuration changes.

- [ ] **Step 1: Write the failing Vue toolchain smoke test**

Create `packages/console-app/tests/fixtures/VueProbe.vue`:

```vue
<template>
  <main>Vue console ready</main>
</template>
```

Create `packages/console-app/tests/vue-toolchain.test.ts`:

```ts
import { render, screen } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import VueProbe from './fixtures/VueProbe.vue';

describe('Vue test toolchain', () => {
  it('renders a Vue component in jsdom', () => {
    render(VueProbe);
    expect(screen.getByRole('main')).toHaveTextContent('Vue console ready');
  });
});
```

- [ ] **Step 2: Run the smoke test and verify the Vue dependencies are missing**

Run: `bun --filter @zipship/console-app test -- tests/vue-toolchain.test.ts`

Expected: FAIL because `vue` or `@testing-library/vue` cannot be resolved.

- [ ] **Step 3: Add Vue dependencies without removing React yet**

Add catalog entries and console dependencies for:

```json
{
  "@testing-library/vue": "catalog:",
  "@vitejs/plugin-vue": "catalog:",
  "@vue/test-utils": "catalog:",
  "@vueuse/core": "catalog:",
  "@lucide/vue": "catalog:",
  "pinia": "catalog:",
  "reka-ui": "catalog:",
  "vue": "catalog:",
  "vue-router": "catalog:",
  "vue-sonner": "catalog:",
  "vue-tsc": "catalog:"
}
```

Use compatible current versions selected by `bun add`; do not add `less`. Keep the React packages temporarily so the pre-migration tests can run until Task 13.

- [ ] **Step 4: Configure Vue compilation and cache inputs**

Configure `packages/console-app/vite.config.ts` with both plugins temporarily:

```ts
plugins: [tailwindcss(), vue(), react()],
```

Change the console typecheck script to:

```json
"typecheck": "vue-tsc --noEmit -p tsconfig.json"
```

Include `src/**/*.vue` and retain `src/**/*.tsx` temporarily. Add Vue files and CSS/HTML to Turbo inputs:

```json
"inputs": ["src/**/*.ts", "src/**/*.tsx", "src/**/*.vue", "src/**/*.css", "index.html", "*.json", "*.ts"]
```

Update test cleanup so both old and new tests can coexist:

```ts
import '@testing-library/jest-dom/vitest';
import { cleanup as cleanupReact } from '@testing-library/react';
import { cleanup as cleanupVue } from '@testing-library/vue';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanupReact();
  cleanupVue();
});
```

- [ ] **Step 5: Install and verify the toolchain**

Run: `bun install`

Expected: dependencies resolve and `bun.lock` changes.

Run: `bun --filter @zipship/console-app test -- tests/vue-toolchain.test.ts`

Expected: PASS.

Run: `bun --filter @zipship/console-app typecheck`

Expected: PASS with both temporary React and new Vue sources included.

- [ ] **Step 6: Commit the toolchain slice**

```bash
git add package.json bun.lock turbo.json tsconfig.base.json .oxlintrc.json packages/console-app
git commit -m "build(console): add Vue migration toolchain"
```

---

### Task 2: Extract Domain Types and Remove Global API Dependencies from Pure Logic

**Files:**
- Modify: `packages/api-client/src/index.ts`
- Create: `packages/console-app/src/domain/projects.ts`
- Create: `packages/console-app/src/domain/members.ts`
- Create: `packages/console-app/src/domain/audit.ts`
- Create: `packages/console-app/src/domain/async.ts`
- Create: `packages/console-app/src/app/context.ts`
- Create: `packages/console-app/tests/app-context.test.ts`
- Create: `packages/console-app/tests/helpers/storeHarness.ts`
- Modify: `packages/console-app/src/features/versions/uploadPipeline.ts`
- Modify: `packages/console-app/src/features/versions/UploadVersionDialog.tsx`
- Modify: `packages/console-app/src/features/project-detail/deploymentSnapshot.ts`
- Modify: `packages/console-app/src/features/project-detail/projectSettingsModel.ts`
- Modify: `packages/console-app/src/features/project-detail/releasePolling.ts`
- Modify: `packages/console-app/src/features/project-detail/releaseReport.ts`
- Modify: `packages/console-app/src/features/project-detail/releaseStatus.ts`
- Modify: `packages/console-app/src/features/project-detail/rolePermissions.ts`
- Modify: `packages/console-app/src/features/project-detail/uploadResultHighlight.ts`
- Modify: `packages/console-app/tests/uploadPipeline.test.ts`

**Interfaces:**
- Produces: `ApiClient = ReturnType<typeof createApiClient>` from `@zipship/api-client`.
- Produces: `ConsoleAppContext`, `createConsoleAppContext()`, and `useConsoleAppContext()`.
- Produces: framework-neutral `Project`, `Release`, `Deployment`, `Member`, `AuditLogEntry`, and input types.
- Produces: `runUploadPipeline(deps, input)` with no module-level API or token access.

- [ ] **Step 1: Write failing context and upload dependency tests**

Add tests for isolated clients, token headers, missing providers, and injected upload dependencies:

```ts
it('builds authorization headers from the context token', () => {
  const context = createConsoleAppContext({ apiBaseUrl: 'http://one', runtime, api });
  expect(context.authHeaders()).toEqual({});
  context.sessionToken.value = 'token-1';
  expect(context.authHeaders()).toEqual({ authorization: 'Bearer token-1' });
});

it('uses the upload dependencies instead of a global client', async () => {
  await runUploadPipeline({ api, authHeaders: () => ({ authorization: 'Bearer t' }) }, input);
  expect(createUpload).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the focused tests and verify the new interfaces are missing**

Run: `bun --filter @zipship/console-app test -- tests/app-context.test.ts tests/uploadPipeline.test.ts`

Expected: FAIL because `app/context.ts`, the domain modules, and dependency-based upload signature do not exist.

- [ ] **Step 3: Export the typed API client and domain contracts**

Add to `packages/api-client/src/index.ts`:

```ts
export type ApiClient = ReturnType<typeof createApiClient>;
```

Use the existing backend/shared literal types where exported, and define these UI-facing inputs:

```ts
export interface ProjectCreateInput {
  name: string;
  slug: string;
  description: string;
}

export interface ProjectUpdateInput {
  name?: string;
  slug?: string;
  description?: string | null;
  spaFallback?: boolean;
  cachePolicy?: 'standard' | 'aggressive';
  customDomains?: string[];
}

export type AssignableMemberRole = Exclude<MemberRole, 'owner'>;
```

Move type imports in every listed pure helper from the Zustand store files to `domain/*`. Do not change helper behavior.

Define the shared request status once:

```ts
export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error';
```

- [ ] **Step 4: Implement the application context**

Implement this exact public shape:

```ts
export type AuthorizationHeaders = { authorization: string } | Record<string, never>;

export interface ConsoleAppContext {
  api: ApiClient;
  apiBaseUrl: string;
  runtime: RuntimeAdapter;
  sessionToken: RemovableRef<string | null>;
  authHeaders(): AuthorizationHeaders;
}

export interface CreateConsoleAppContextOptions {
  apiBaseUrl: string;
  runtime: RuntimeAdapter;
  api?: ApiClient;
}

export const consoleAppContextKey: InjectionKey<ConsoleAppContext>;
export function createConsoleAppContext(options: CreateConsoleAppContextOptions): ConsoleAppContext;
export function useConsoleAppContext(): ConsoleAppContext;
```

`createConsoleAppContext` calls `createApiClient()` unless a test client is passed and uses:

```ts
useSessionStorage<string | null>('zipship_refresh_token', null, { writeDefaults: false })
```

`useConsoleAppContext()` throws `Console app context is not installed` when injection is missing.

- [ ] **Step 5: Inject dependencies into the upload pipeline**

Use this signature:

```ts
export interface UploadPipelineDependencies {
  api: ApiClient;
  authHeaders: () => AuthorizationHeaders;
}

export interface RunUploadPipelineInput {
  projectId: string;
  file: File;
  onState: (state: UploadState) => void;
}

export function runUploadPipeline(
  dependencies: UploadPipelineDependencies,
  input: RunUploadPipelineInput,
): Promise<void>;
```

Keep the current three API steps, progress states, and typed error reasons unchanged.

Update the temporary React `UploadVersionDialog.tsx` call site to pass `{ api: getApi(), authHeaders }` explicitly. This compatibility edit keeps the old React test suite type-correct during migration; Task 13 deletes the React component and global client.

- [ ] **Step 6: Verify all framework-neutral tests**

Run: `bun --filter @zipship/console-app test -- tests/app-context.test.ts tests/uploadPipeline.test.ts tests/deploymentSnapshot.test.ts tests/projectPreviewUrls.test.ts tests/projectSettingsModel.test.ts tests/releasePolling.test.ts tests/releaseReport.test.ts tests/releaseStatus.test.ts tests/rolePermissions.test.ts tests/uploadDialogModel.test.ts tests/uploadResultHighlight.test.ts tests/validation.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the domain boundary**

```bash
git add packages/api-client packages/console-app/src/app packages/console-app/src/domain packages/console-app/src/features packages/console-app/tests
git commit -m "refactor(console): isolate domain and API context"
```

---

### Task 3: Migrate Settings, Translation, and Authentication to Pinia

**Files:**
- Create: `packages/console-app/src/stores/settings.ts`
- Create: `packages/console-app/src/stores/auth.ts`
- Create: `packages/console-app/src/i18n/useTranslation.ts`
- Create: `packages/console-app/tests/settings-vue.test.ts`
- Create: `packages/console-app/tests/i18n-vue.test.ts`
- Create: `packages/console-app/tests/auth-vue.test.ts`
- Modify: `packages/console-app/tests/helpers/storeHarness.ts`

**Interfaces:**
- Produces: `useSettingsStore()` with `theme`, `language`, `initialized`, `init()`, `setTheme()`, and `setLanguage()`.
- Produces: `useAuthStore()` with runtime-derived login/register, server-revoking logout, and explicit `clearSession()`.
- Produces: reactive `useTranslation()` over the existing `en.ts` and `zh.ts` dictionaries.

- [ ] **Step 1: Write failing settings and translation tests**

Cover valid/invalid persisted values, theme class, reactive language switching, interpolation, missing keys, and dictionary parity:

```ts
it('falls back from invalid persisted settings', () => {
  localStorage.setItem('zipship_theme', 'broken');
  localStorage.setItem('zipship_language', 'broken');
  const store = createSettingsStoreHarness();
  store.init();
  expect(store.theme).toBe('day');
  expect(store.language).toBe('zh');
});

it('translates reactively after changing language', () => {
  const settings = useSettingsStore();
  const { t } = useTranslation();
  const zhTitle = t('projects.title');
  settings.setLanguage('en');
  expect(t('projects.title')).not.toBe(zhTitle);
});
```

- [ ] **Step 2: Write failing authentication tests**

Cover Web/Desktop client type, token persistence, session recovery, revocation, and failure cleanup:

```ts
it('uses the desktop runtime for registration', async () => {
  const { store, api } = createAuthHarness({ runtimeKind: 'desktop' });
  await store.register('Ada', 'ada@example.com', 'secret123');
  expect(api._api.auth.register.post).toHaveBeenCalledWith({
    name: 'Ada', email: 'ada@example.com', password: 'secret123', clientType: 'desktop',
  });
});

it('clears local state when server revocation fails', async () => {
  const { store, context } = createAuthenticatedAuthHarness({ logoutRejects: true });
  await expect(store.logout()).rejects.toThrow();
  expect(context.sessionToken.value).toBeNull();
  expect(store.status).toBe('login');
});
```

- [ ] **Step 3: Verify the Pinia stores are not implemented**

Run: `bun --filter @zipship/console-app test -- tests/settings-vue.test.ts tests/i18n-vue.test.ts tests/auth-vue.test.ts`

Expected: FAIL because the Vue stores and composable do not exist.

- [ ] **Step 4: Implement the settings setup store**

Use this public contract:

```ts
export type Theme = 'day' | 'night';
export type Language = 'zh' | 'en';

export const useSettingsStore = defineStore('settings', () => {
  const theme = useLocalStorage<Theme>('zipship_theme', 'day', validatedThemeOptions);
  const language = useLocalStorage<Language>('zipship_language', 'zh', validatedLanguageOptions);
  const initialized = ref(false);
  function init(): void;
  function setTheme(value: Theme): void;
  function setLanguage(value: Language): void;
  return { theme, language, initialized, init, setTheme, setLanguage };
});
```

Validate storage reads against literal allowlists and apply:

```ts
watch(theme, value => document.documentElement.classList.toggle('night', value === 'night'), {
  immediate: true,
});
```

- [ ] **Step 5: Implement reactive translation without a new i18n framework**

Keep the dictionaries and implement:

```ts
export function useTranslation() {
  const settings = useSettingsStore();
  const t = (key: string, params?: Record<string, string | number>): string => {
    const text = resolvePath(locales[settings.language], key);
    return interpolate(text ?? key, params);
  };
  return { t, language: computed(() => settings.language) };
}
```

`resolvePath` accepts `unknown` and narrows each object segment. Tests must verify all leaf keys and interpolation placeholders match across `en` and `zh`.

- [ ] **Step 6: Implement the authentication setup store**

Use this interface:

```ts
export type AuthStatus = 'loading' | 'login' | 'authenticated';

export const useAuthStore = defineStore('auth', () => {
  const status = ref<AuthStatus>('loading');
  const user = ref<AuthUser | null>(null);
  async function initSession(): Promise<void>;
  async function login(email: string, password: string): Promise<void>;
  async function register(name: string, email: string, password: string): Promise<void>;
  async function logout(): Promise<void>;
  async function updateProfile(name: string): Promise<void>;
  function clearSession(): void;
  return { status, user, initSession, login, register, logout, updateProfile, clearSession };
});
```

Both login and registration read `context.runtime.kind`. Logout calls:

```ts
await api._api.auth.logout.post(undefined, { headers: context.authHeaders() });
```

and clears session state in `finally`. `initSession()` makes no request without a token and clears invalid sessions.

- [ ] **Step 7: Run focused tests and typecheck**

Run: `bun --filter @zipship/console-app test -- tests/settings-vue.test.ts tests/i18n-vue.test.ts tests/auth-vue.test.ts`

Expected: PASS.

Run: `bun --filter @zipship/console-app typecheck`

Expected: PASS.

- [ ] **Step 8: Commit the state slice**

```bash
git add packages/console-app/src/stores packages/console-app/src/i18n packages/console-app/tests
git commit -m "refactor(console): migrate auth and settings to Pinia"
```

---

### Task 4: Build the Project-Owned Vue UI Adapter Layer

**Files:**
- Modify: `packages/console-app/src/lib/utils.ts`
- Create: `packages/console-app/src/components/ui/index.ts`
- Create: `packages/console-app/src/components/ui/UiButton.vue`
- Create: `packages/console-app/src/components/ui/UiInput.vue`
- Create: `packages/console-app/src/components/ui/UiTextarea.vue`
- Create: `packages/console-app/src/components/ui/UiFormField.vue`
- Create: `packages/console-app/src/components/ui/UiCard.vue`
- Create: `packages/console-app/src/components/ui/UiCheckbox.vue`
- Create: `packages/console-app/src/components/ui/UiBadge.vue`
- Create: `packages/console-app/src/components/ui/UiAlert.vue`
- Create: `packages/console-app/src/components/ui/UiEmptyState.vue`
- Create: `packages/console-app/src/components/ui/UiProgress.vue`
- Create: `packages/console-app/src/components/ui/UiSkeleton.vue`
- Create: `packages/console-app/src/components/ui/UiModal.vue`
- Create: `packages/console-app/src/components/ui/UiConfirmDialog.vue`
- Create: `packages/console-app/src/components/ui/UiDropdownMenu.vue`
- Create: `packages/console-app/src/components/ui/UiSelect.vue`
- Create: `packages/console-app/src/components/ui/UiSwitch.vue`
- Create: `packages/console-app/src/components/ui/UiDrawer.vue`
- Create: `packages/console-app/src/components/ui/UiToastHost.vue`
- Create: `packages/console-app/src/components/ui/notify.ts`
- Create: `packages/console-app/tests/ui-adapters.test.ts`

**Interfaces:**
- Produces: stable project-owned props/emits for all product pages.
- Produces: modal, drawer, dropdown, and select focus/keyboard behavior implemented through Reka UI only inside this directory.
- Produces: variant styling through Tailwind/CVA and existing CSS tokens.

- [ ] **Step 1: Write failing adapter behavior tests**

Test button variants and disabled state, labeled fields, modal focus restoration, escape close, confirm events, select updates, drawer close, and dropdown keyboard selection:

```ts
it('emits confirm once and restores focus', async () => {
  const { emitted, user } = renderConfirmDialog();
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  expect(emitted().confirm).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
});
```

- [ ] **Step 2: Run the adapter test and verify components are missing**

Run: `bun --filter @zipship/console-app test -- tests/ui-adapters.test.ts`

Expected: FAIL because the Vue adapter components do not exist.

- [ ] **Step 3: Implement stable primitive props and emits**

Use explicit contracts such as:

```ts
export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

defineProps<{ variant?: ButtonVariant; size?: ButtonSize; loading?: boolean; disabled?: boolean }>();
defineEmits<{ click: [event: MouseEvent] }>();
```

```ts
defineProps<{ open: boolean; title: string; description?: string; busy?: boolean }>();
defineEmits<{ 'update:open': [open: boolean]; confirm: []; cancel: [] }>();
```

All library-specific component names, portal props, emitted values, and Vue Sonner calls remain internal. Forward accessible names, descriptions, invalid state, disabled state, and focus targets through the project contract. Features call `notify.success()`, `notify.error()`, or `notify.info()` from `components/ui/notify.ts`; they never import `vue-sonner`.

- [ ] **Step 4: Implement visual tokens without Less**

Use the existing `cn()` helper, Tailwind v4 classes, and CSS variables. Do not duplicate theme colors in component-local styles. Simple primitives use native semantic elements; focus-managed primitives use Reka UI.

- [ ] **Step 5: Run adapter tests and typecheck**

Run: `bun --filter @zipship/console-app test -- tests/ui-adapters.test.ts`

Expected: PASS.

Run: `bun --filter @zipship/console-app typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the UI boundary**

```bash
git add packages/console-app/src/components/ui packages/console-app/src/lib/utils.ts packages/console-app/tests/ui-adapters.test.ts
git commit -m "feat(console): add Vue UI adapter layer"
```

---

### Task 5: Create the Vue App Factory, Authentication Gate, Router, and Responsive Layout

**Files:**
- Create: `packages/console-app/src/app/router.ts`
- Create: `packages/console-app/src/app/createConsoleApp.ts`
- Create: `packages/console-app/src/App.vue`
- Create: `packages/console-app/src/pages/LoginPage.vue`
- Create: `packages/console-app/src/pages/ComingSoonPage.vue`
- Create: `packages/console-app/src/pages/ProjectListPage.vue`
- Create: `packages/console-app/src/pages/ProjectDetailPage.vue`
- Create: `packages/console-app/src/features/layout/AppLayout.vue`
- Create: `packages/console-app/src/features/layout/AppHeader.vue`
- Create: `packages/console-app/src/features/layout/AppNavigation.vue`
- Create: `packages/console-app/src/composables/useIsMobile.ts`
- Create: `packages/console-app/tests/app-factory.test.ts`
- Create: `packages/console-app/tests/login-page-vue.test.ts`
- Create: `packages/console-app/tests/layout-vue.test.ts`
- Create: `packages/console-app/tests/useIsMobile.test.ts`

**Interfaces:**
- Produces: `createConsoleApp(options): App<Element>` with fresh app context, Pinia, and router.
- Produces: `createConsoleRouter(history?: RouterHistory): Router`.
- Produces: stable routes including nested project-detail sections.
- Produces: responsive navigation using `useMediaQuery` and internal router links.

- [ ] **Step 1: Write failing factory, auth gate, route, and responsive tests**

Cover fresh instances, login/loading/authenticated gates, redirects, nested routes, internal navigation without reload, mobile drawer, and media query changes:

```ts
it('creates isolated app dependencies', () => {
  const first = createConsoleApp(options);
  const second = createConsoleApp(options);
  expect(first).not.toBe(second);
});

it('redirects a project root to versions', async () => {
  const router = createConsoleRouter(createMemoryHistory());
  await router.push('/app/projects/p1');
  await router.isReady();
  expect(router.currentRoute.value.fullPath).toBe('/app/projects/p1/versions');
});
```

- [ ] **Step 2: Run focused tests and verify the Vue application is missing**

Run: `bun --filter @zipship/console-app test -- tests/app-factory.test.ts tests/login-page-vue.test.ts tests/layout-vue.test.ts tests/useIsMobile.test.ts`

Expected: FAIL because the factory, SFCs, and composable do not exist.

- [ ] **Step 3: Implement the router contract**

Create routes for:

```ts
[
  '/app/projects',
  '/app/projects/:projectId/versions',
  '/app/projects/:projectId/members',
  '/app/projects/:projectId/deployments',
  '/app/projects/:projectId/settings',
  '/app/projects/:projectId/activity',
  '/app/logs',
  '/app/storage',
]
```

Redirect `/app`, `/app/projects/:projectId`, and unknown paths according to the design. Accept a test history and default to `createWebHistory()`.

- [ ] **Step 4: Implement the application factory and auth gate**

Use this exact interface:

```ts
export interface ConsoleAppOptions {
  runtime: RuntimeAdapter;
  apiBaseUrl: string;
}

export function createConsoleApp(options: ConsoleAppOptions): App<Element> {
  const app = createApp(AppRoot);
  const pinia = createPinia();
  const router = createConsoleRouter();
  const context = createConsoleAppContext(options);
  app.provide(consoleAppContextKey, context);
  app.use(pinia);
  app.use(router);
  return app;
}
```

`App.vue` calls settings/session initialization once and displays loading, login, or the router view plus `UiToastHost` and a render-error fallback.

- [ ] **Step 5: Implement login and responsive layout**

`LoginPage.vue` owns form draft state and Zod validation, and emits no client type. It calls the auth store and displays inline errors plus toast feedback.

`AppLayout.vue` owns create-project, settings, profile, and logout dialog state. `AppHeader.vue` and `AppNavigation.vue` receive explicit props/emits. Internal destinations use `RouterLink`.

Implement:

```ts
export const MOBILE_QUERY = '(max-width: 767px)';
export function useIsMobile(): ComputedRef<boolean> {
  const mediaQuery = useMediaQuery(MOBILE_QUERY);
  return computed(() => mediaQuery.value);
}
```

- [ ] **Step 6: Run focused tests and typecheck**

Run: `bun --filter @zipship/console-app test -- tests/app-factory.test.ts tests/login-page-vue.test.ts tests/layout-vue.test.ts tests/useIsMobile.test.ts`

Expected: PASS.

Run: `bun --filter @zipship/console-app typecheck`

Expected: PASS.

- [ ] **Step 7: Commit the runnable Vue shell**

```bash
git add packages/console-app/src/app packages/console-app/src/App.vue packages/console-app/src/pages packages/console-app/src/features/layout packages/console-app/src/composables packages/console-app/tests
git commit -m "feat(console): create Vue app shell and router"
```

---

### Task 6: Migrate Projects State, Project List, and Creation

**Files:**
- Create: `packages/console-app/src/stores/projects.ts`
- Create: `packages/console-app/src/features/projects/CreateProjectDialog.vue`
- Modify: `packages/console-app/src/pages/ProjectListPage.vue`
- Modify: `packages/console-app/src/features/layout/AppLayout.vue`
- Create: `packages/console-app/tests/projects-vue.test.ts`
- Create: `packages/console-app/tests/project-list-vue.test.ts`
- Create: `packages/console-app/tests/create-project-vue.test.ts`

**Interfaces:**
- Produces: per-resource async status, request sequencing, deep-link project fetch, and local upserts.
- Produces: `createProject()` returns the created project and routes to it.
- Consumes: context API/auth headers, domain project types, UI adapters, translation.

- [ ] **Step 1: Write failing Pinia project tests**

Cover list success/error/retry, organization discovery, detail fetch, create/update upsert, delete cleanup, per-project release/deployment state, and stale response rejection:

```ts
it('keeps the newest release response for a project', async () => {
  const { store, requests } = createProjectsHarness();
  const first = store.fetchReleases('p1');
  const second = store.fetchReleases('p1');
  requests.releases[1].resolve([newRelease]);
  requests.releases[0].resolve([oldRelease]);
  await Promise.all([first, second]);
  expect(store.releasesByProject.p1).toEqual([newRelease]);
});
```

- [ ] **Step 2: Write failing list and creation component tests**

Cover loading, empty, error/retry, project cards, validation, duplicate slug, successful close, and routing to the new project.

- [ ] **Step 3: Run focused tests and verify the project slice is missing**

Run: `bun --filter @zipship/console-app test -- tests/projects-vue.test.ts tests/project-list-vue.test.ts tests/create-project-vue.test.ts`

Expected: FAIL.

- [ ] **Step 4: Implement the project setup store**

Expose:

```ts
projects: Ref<Project[]>;
organizationId: Ref<string | null>;
listStatus: Ref<'idle' | 'loading' | 'success' | 'error'>;
listError: Ref<string | null>;
releasesByProject: Ref<Record<string, Release[]>>;
releaseStatusByProject: Ref<Record<string, AsyncStatus>>;
releaseErrorsByProject: Ref<Record<string, string | null>>;
deploymentsByProject: Ref<Record<string, Deployment[]>>;
deploymentStatusByProject: Ref<Record<string, AsyncStatus>>;
deploymentErrorsByProject: Ref<Record<string, string | null>>;
fetchProjects(): Promise<void>;
fetchProject(projectId: string): Promise<Project | null>;
createProject(input: ProjectCreateInput): Promise<Project>;
fetchReleases(projectId: string): Promise<void>;
fetchDeployments(projectId: string): Promise<void>;
publishRelease(projectId: string, releaseId: string, message?: string | null): Promise<void>;
rollbackRelease(projectId: string, releaseId: string, message?: string | null): Promise<void>;
updateProject(projectId: string, input: ProjectUpdateInput): Promise<Project>;
deleteProject(projectId: string): Promise<void>;
reset(): void;
```

Use monotonically increasing request IDs for the list and per-project release/deployment requests. Ignore a response whose ID is no longer current.

- [ ] **Step 5: Implement the project list and create workflow**

The list renders derived counts, recent projects, empty/error/retry states, and accessible project links. `CreateProjectDialog.vue` validates with existing Zod rules, calls `createProject`, closes only on success, and routes to `/app/projects/:id/versions`.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `bun --filter @zipship/console-app test -- tests/projects-vue.test.ts tests/project-list-vue.test.ts tests/create-project-vue.test.ts`

Expected: PASS.

Run: `bun --filter @zipship/console-app typecheck`

Expected: PASS.

- [ ] **Step 7: Commit the projects slice**

```bash
git add packages/console-app/src/stores/projects.ts packages/console-app/src/pages/ProjectListPage.vue packages/console-app/src/features/projects packages/console-app/src/features/layout/AppLayout.vue packages/console-app/tests
git commit -m "feat(console): migrate projects workflow to Vue"
```

---

### Task 7: Build Project Detail Loading, Header, Production, and Preview

**Files:**
- Create: `packages/console-app/src/features/project-detail/ProjectDetailHeader.vue`
- Create: `packages/console-app/src/features/project-detail/ProjectProductionPanel.vue`
- Create: `packages/console-app/src/features/project-detail/ProjectPreviewPanel.vue`
- Create: `packages/console-app/src/features/project-detail/ProjectDetailNavigation.vue`
- Modify: `packages/console-app/src/pages/ProjectDetailPage.vue`
- Modify: `packages/console-app/src/app/router.ts`
- Create: `packages/console-app/tests/project-detail-layout-vue.test.ts`
- Create: `packages/console-app/tests/project-detail-panels-vue.test.ts`

**Interfaces:**
- Produces: project route parameter is the source of truth and child route is the active section.
- Produces: safe parallel loading and state reset when the project ID changes.
- Consumes: project store, runtime `openExternal`, preview URL helpers, role permissions.

- [ ] **Step 1: Write failing detail orchestration and panel tests**

Cover direct deep link, missing cached project, route change, section-level errors, active/ready preview selection, upload permission, and runtime-mediated external opening.

```ts
it('loads a deep-linked project that is not in the list store', async () => {
  await router.push('/app/projects/p9/versions');
  renderProjectDetail();
  await waitFor(() => expect(projects.fetchProject).toHaveBeenCalledWith('p9'));
});
```

- [ ] **Step 2: Run focused tests and verify detail components are missing**

Run: `bun --filter @zipship/console-app test -- tests/project-detail-layout-vue.test.ts tests/project-detail-panels-vue.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement detail route orchestration**

On route entry or `projectId` change:

```ts
await Promise.allSettled([
  projects.fetchProject(projectId),
  projects.fetchReleases(projectId),
  projects.fetchDeployments(projectId),
]);
```

Reset local dialog/highlight state before starting the next project load.

At this task boundary, load project, release, and deployment state only. Task 9 adds members and audit after their organization-scoped Pinia stores exist. Never show the prior project's data under the new route.

- [ ] **Step 4: Implement the header, production, preview, and child navigation**

Use explicit props/emits and project-owned primitives. Compute active and preview releases from store data. All external preview/live actions call:

```ts
await context.runtime.openExternal(url);
```

The section navigation is a set of `RouterLink` destinations, not a local tab ref.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `bun --filter @zipship/console-app test -- tests/project-detail-layout-vue.test.ts tests/project-detail-panels-vue.test.ts`

Expected: PASS.

Run: `bun --filter @zipship/console-app typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the detail shell**

```bash
git add packages/console-app/src/app/router.ts packages/console-app/src/pages/ProjectDetailPage.vue packages/console-app/src/features/project-detail packages/console-app/tests
git commit -m "feat(console): add Vue project detail shell"
```

---

### Task 8: Migrate Releases, Publish, Rollback, Reports, and Deployment History

**Files:**
- Create: `packages/console-app/src/features/project-detail/ProjectVersionsView.vue`
- Create: `packages/console-app/src/features/project-detail/ProjectReleaseReport.vue`
- Create: `packages/console-app/src/features/project-detail/DeploymentConfirmDialog.vue`
- Create: `packages/console-app/src/features/project-detail/ProjectDeploymentsView.vue`
- Create: `packages/console-app/tests/project-versions-vue.test.ts`
- Create: `packages/console-app/tests/release-report-vue.test.ts`
- Create: `packages/console-app/tests/deployment-confirm-vue.test.ts`
- Create: `packages/console-app/tests/project-deployments-vue.test.ts`

**Interfaces:**
- Produces: `/versions` and `/deployments` child views.
- Produces: publish/rollback confirmation with failed-release risk gate.
- Consumes: pure release report/status/snapshot helpers and project store mutations.

- [ ] **Step 1: Write failing behavior tests**

Cover loading/error/retry, report expansion, preview, publish eligibility, rollback eligibility, confirmation message, failed-release acknowledgement, mutation busy state, mutation error, deployment-to-release labels, and empty history.

```ts
it('requires explicit acknowledgement for a failed release', async () => {
  renderDeploymentConfirm({ releaseStatus: 'failed' });
  expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: /understand/i }));
  expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled();
});
```

- [ ] **Step 2: Run focused tests and verify the Vue views are missing**

Run: `bun --filter @zipship/console-app test -- tests/project-versions-vue.test.ts tests/release-report-vue.test.ts tests/deployment-confirm-vue.test.ts tests/project-deployments-vue.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement release and deployment views**

Render release status, version/hash metadata, file counts/sizes, active state, report details, and available actions from the existing pure helpers. Do not duplicate status policy in templates.

The confirmation component emits:

```ts
defineEmits<{
  'update:open': [open: boolean];
  confirm: [message: string | null];
}>();
```

Keep it open on mutation failure and close only after a successful store action.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `bun --filter @zipship/console-app test -- tests/project-versions-vue.test.ts tests/release-report-vue.test.ts tests/deployment-confirm-vue.test.ts tests/project-deployments-vue.test.ts`

Expected: PASS.

Run: `bun --filter @zipship/console-app typecheck`

Expected: PASS.

- [ ] **Step 5: Commit release operations**

```bash
git add packages/console-app/src/features/project-detail packages/console-app/tests
git commit -m "feat(console): migrate release deployment views"
```

---

### Task 9: Migrate Members, Invitations, and Audit Activity

**Files:**
- Create: `packages/console-app/src/stores/members.ts`
- Create: `packages/console-app/src/stores/audit.ts`
- Create: `packages/console-app/src/features/members/InviteMemberDialog.vue`
- Create: `packages/console-app/src/features/project-detail/ProjectMembersView.vue`
- Create: `packages/console-app/src/features/project-detail/ProjectActivityView.vue`
- Modify: `packages/console-app/src/pages/ProjectDetailPage.vue`
- Create: `packages/console-app/tests/members-vue.test.ts`
- Create: `packages/console-app/tests/audit-vue.test.ts`
- Create: `packages/console-app/tests/project-members-vue.test.ts`
- Create: `packages/console-app/tests/project-activity-vue.test.ts`

**Interfaces:**
- Produces: organization-scoped buckets and request sequencing for members/audit.
- Produces: typed assignable roles without `any`.
- Produces: permission-aware member mutations and invitation link copying.

- [ ] **Step 1: Write failing store isolation tests**

```ts
it('does not overwrite organization B with a late organization A response', async () => {
  const first = store.fetchMembers('org-a');
  const second = store.fetchMembers('org-b');
  resolveMembers('org-b', [memberB]);
  resolveMembers('org-a', [memberA]);
  await Promise.all([first, second]);
  expect(store.membersFor('org-a')).toEqual([memberA]);
  expect(store.membersFor('org-b')).toEqual([memberB]);
});
```

Also test error completion, reset, role updates/removal only in the target bucket, and audit response errors.

- [ ] **Step 2: Write failing member/activity component tests**

Cover loading, empty, error/retry, read-only roles, self/last-owner protections, invite validation, invitation copy success/failure, role changes, removal confirmation, and audit metadata rendering.

- [ ] **Step 3: Run focused tests and verify the slice is missing**

Run: `bun --filter @zipship/console-app test -- tests/members-vue.test.ts tests/audit-vue.test.ts tests/project-members-vue.test.ts tests/project-activity-vue.test.ts`

Expected: FAIL.

- [ ] **Step 4: Implement organization-scoped stores**

Expose:

```ts
membersByOrganization: Ref<Record<string, Member[]>>;
statusByOrganization: Ref<Record<string, AsyncStatus>>;
errorsByOrganization: Ref<Record<string, string | null>>;
membersFor(organizationId: string): Member[];
fetchMembers(organizationId: string): Promise<void>;
inviteMember(organizationId: string, email: string, role: AssignableMemberRole): Promise<{ inviteUrl: string }>;
updateMemberRole(organizationId: string, userId: string, role: AssignableMemberRole): Promise<void>;
removeMember(organizationId: string, userId: string): Promise<void>;
reset(): void;
```

Audit follows the same bucket/status/error pattern with `logsFor()` and `fetchAudit()`.

- [ ] **Step 5: Implement member and activity views**

Use current-user membership and `getProjectRolePermissions()` to compute allowed actions. Guard in both component handlers and store actions. Use `useClipboard({ legacy: true })` for invitation links and report feedback through the toast adapter.

After `ProjectDetailPage.vue` resolves the project, call `fetchMembers(project.organizationId)` and `fetchAudit(project.organizationId)` in the same route generation. Organization buckets prevent late results from another project from appearing in the active view.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `bun --filter @zipship/console-app test -- tests/members-vue.test.ts tests/audit-vue.test.ts tests/project-members-vue.test.ts tests/project-activity-vue.test.ts`

Expected: PASS.

Run: `bun --filter @zipship/console-app typecheck`

Expected: PASS.

- [ ] **Step 7: Commit collaboration views**

```bash
git add packages/console-app/src/stores packages/console-app/src/features/members packages/console-app/src/features/project-detail packages/console-app/tests
git commit -m "feat(console): migrate members and activity views"
```

---

### Task 10: Migrate Project Settings, Profile, Preferences, and Destructive Actions

**Files:**
- Create: `packages/console-app/src/features/project-detail/ProjectSettingsView.vue`
- Create: `packages/console-app/src/features/settings/ProfileEditDialog.vue`
- Create: `packages/console-app/src/features/settings/SettingsDialog.vue`
- Modify: `packages/console-app/src/features/layout/AppLayout.vue`
- Create: `packages/console-app/tests/project-settings-vue.test.ts`
- Create: `packages/console-app/tests/profile-settings-vue.test.ts`

**Interfaces:**
- Produces: model-driven project settings with validation and permission-aware read-only state.
- Produces: profile update plus theme/language preferences through Pinia settings.
- Produces: destructive delete confirmation and post-success routing.

- [ ] **Step 1: Write failing settings behavior tests**

Cover initial model, dirty state, validation, save error, read-only state, cache policy, SPA fallback, custom-domain normalization, delete confirmation, delete failure, successful navigation, profile save, language change, and theme class.

- [ ] **Step 2: Run focused tests and verify settings components are missing**

Run: `bun --filter @zipship/console-app test -- tests/project-settings-vue.test.ts tests/profile-settings-vue.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement project settings from the pure model**

Create and validate draft state through `projectSettingsModel.ts`. Disable mutation controls when `canManage` is false. Save uses `projects.updateProject()` and replaces the local draft from the returned project.

Deletion requires typing or explicitly confirming the project name, calls `deleteProject()`, and routes to `/app/projects` only after success.

- [ ] **Step 4: Implement profile and preferences dialogs**

Profile uses `auth.updateProfile()`. Preferences use `settings.setTheme()` and `settings.setLanguage()`; no component writes localStorage or document classes directly.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `bun --filter @zipship/console-app test -- tests/project-settings-vue.test.ts tests/profile-settings-vue.test.ts`

Expected: PASS.

Run: `bun --filter @zipship/console-app typecheck`

Expected: PASS.

- [ ] **Step 6: Commit settings**

```bash
git add packages/console-app/src/features/project-detail/ProjectSettingsView.vue packages/console-app/src/features/settings packages/console-app/src/features/layout/AppLayout.vue packages/console-app/tests
git commit -m "feat(console): migrate settings workflows"
```

---

### Task 11: Migrate Artifact Selection, Upload UI, and Visibility-Aware Release Polling

**Files:**
- Create: `packages/console-app/src/composables/useArtifactSelection.ts`
- Create: `packages/console-app/src/composables/useProjectReleasePolling.ts`
- Create: `packages/console-app/src/features/versions/UploadVersionDialog.vue`
- Modify: `packages/console-app/src/pages/ProjectDetailPage.vue`
- Modify: `packages/console-app/src/features/project-detail/ProjectVersionsView.vue`
- Create: `packages/console-app/tests/useArtifactSelection.test.ts`
- Create: `packages/console-app/tests/useProjectReleasePolling-vue.test.ts`
- Create: `packages/console-app/tests/upload-version-vue.test.ts`

**Interfaces:**
- Produces: ZIP, directory, single HTML, and drag/drop selection.
- Produces: bounded, non-overlapping, visibility-aware release polling.
- Consumes: dependency-based pure upload pipeline and upload dialog model.

- [ ] **Step 1: Write failing selection and polling tests**

Use fake timers and mocked visibility to cover first fetch, pending continuation, settled stop, 24-attempt stop, hidden pause without attempt increment, visible resume, no overlapping async fetch, explicit stop, route unmount, and project change.

```ts
it('pauses without consuming attempts while hidden', async () => {
  visibility.value = 'hidden';
  polling.start();
  await vi.advanceTimersByTimeAsync(7500);
  expect(fetchReleases).not.toHaveBeenCalled();
  expect(polling.attempts.value).toBe(0);
});
```

Selection tests cover ZIP accept, single HTML packaging, directory packaging, drop classification, oversize/invalid feedback, and reset.

- [ ] **Step 2: Write failing upload component tests**

Cover all three modes, drop zone, progress states, offline state, pipeline error details, close protection during upload, success callback, and reset on reopen.

- [ ] **Step 3: Run focused tests and verify composables/UI are missing**

Run: `bun --filter @zipship/console-app test -- tests/useArtifactSelection.test.ts tests/useProjectReleasePolling-vue.test.ts tests/upload-version-vue.test.ts`

Expected: FAIL.

- [ ] **Step 4: Implement artifact selection with VueUse**

Use `useFileDialog()` for ZIP and HTML and a directory-enabled dialog for folders. Use `useDropZone()` on the drop target. Convert folder and HTML selections with existing JSZip/model helpers so the pipeline always receives one uploadable ZIP `File`.

- [ ] **Step 5: Implement polling with bounded attempts and visibility**

Expose:

```ts
export interface UseProjectReleasePollingOptions {
  projectId: MaybeRefOrGetter<string | undefined>;
  authenticated: MaybeRefOrGetter<boolean>;
  releases: MaybeRefOrGetter<readonly Pick<Release, 'status'>[]>;
  fetchReleases: (projectId: string) => Promise<void>;
  intervalMs?: number;
  maxAttempts?: number;
}

export function useProjectReleasePolling(options: UseProjectReleasePollingOptions): {
  isPolling: Readonly<Ref<boolean>>;
  attempts: Readonly<Ref<number>>;
  start(): void;
  stop(): void;
};
```

Use `useIntervalFn(..., { immediate: false })`, `useDocumentVisibility()`, and an `inFlight` guard. Default to 2,500 ms and 24 attempts. Stop on success, terminal state, max attempts, route/project change, logout, or unmount.

- [ ] **Step 6: Implement upload completion orchestration**

Record the prior newest release ID, run the injected pipeline, start polling, and use `findUploadedReleaseHighlight()` when new releases arrive. Route to `/versions`, expand/highlight the new release, and clear the anchor.

- [ ] **Step 7: Run focused tests and typecheck**

Run: `bun --filter @zipship/console-app test -- tests/useArtifactSelection.test.ts tests/useProjectReleasePolling-vue.test.ts tests/upload-version-vue.test.ts tests/uploadPipeline.test.ts tests/uploadDialogModel.test.ts tests/releasePolling.test.ts tests/uploadResultHighlight.test.ts`

Expected: PASS.

Run: `bun --filter @zipship/console-app typecheck`

Expected: PASS.

- [ ] **Step 8: Commit upload and polling**

```bash
git add packages/console-app/src/composables packages/console-app/src/features/versions packages/console-app/src/features/project-detail packages/console-app/tests
git commit -m "feat(console): migrate artifact upload workflow"
```

---

### Task 12: Wire Every Project Detail Child Route and Complete Vue Component Coverage

**Files:**
- Modify: `packages/console-app/src/app/router.ts`
- Modify: `packages/console-app/src/features/project-detail/ProjectDetailNavigation.vue`
- Modify: `packages/console-app/src/pages/ProjectDetailPage.vue`
- Create: `packages/console-app/tests/project-detail-routes-vue.test.ts`
- Create: `packages/console-app/tests/critical-workflows-vue.test.ts`

**Interfaces:**
- Produces: each nested route renders its completed Vue view.
- Produces: one integrated memory-router test for upload-to-highlight, publish-to-history, member change, settings update, and audit retry.

- [ ] **Step 1: Write failing route and integrated workflow tests**

Assert each path renders the correct landmark and browser back/forward restores it. Test one complete project-detail session with mock API state transitions.

- [ ] **Step 2: Run tests and verify incomplete route wiring fails**

Run: `bun --filter @zipship/console-app test -- tests/project-detail-routes-vue.test.ts tests/critical-workflows-vue.test.ts`

Expected: FAIL until every child view is wired.

- [ ] **Step 3: Wire the child routes**

Map:

```ts
versions -> ProjectVersionsView.vue
members -> ProjectMembersView.vue
deployments -> ProjectDeploymentsView.vue
settings -> ProjectSettingsView.vue
activity -> ProjectActivityView.vue
```

Keep shared project/header/panel loading in `ProjectDetailPage.vue` and render children through `RouterView` so section changes do not repeat the project bootstrap.

- [ ] **Step 4: Verify the complete Vue console before shell cutover**

Run: `bun --filter @zipship/console-app test`

Expected: all retained React tests, pure TypeScript tests, and new Vue tests pass at this intermediate point.

Run: `bun --filter @zipship/console-app typecheck`

Expected: PASS.

- [ ] **Step 5: Commit complete Vue route coverage**

```bash
git add packages/console-app/src/app/router.ts packages/console-app/src/features/project-detail packages/console-app/src/pages/ProjectDetailPage.vue packages/console-app/tests
git commit -m "test(console): cover Vue project workflows"
```

---

### Task 13: Switch Web and Tauri Shells, Use the Native Runtime, and Remove React

**Files:**
- Create: `packages/console-app/src/index.ts`
- Modify: `packages/console-app/package.json`
- Modify: `packages/console-app/tsconfig.json`
- Modify: `packages/console-app/vite.config.ts`
- Modify: `packages/console-app/src/index.css`
- Delete: `packages/console-app/src/index.tsx`
- Delete: `packages/console-app/src/App.tsx`
- Delete: `packages/console-app/src/router.tsx`
- Delete: `packages/console-app/src/components/**/*.tsx`
- Delete: `packages/console-app/src/features/**/*.tsx`
- Delete: `packages/console-app/src/pages/**/*.tsx`
- Delete: `packages/console-app/src/hooks/use-mobile.ts`
- Delete: `packages/console-app/src/stores/authStore.ts`
- Delete: `packages/console-app/src/stores/projectsStore.ts`
- Delete: `packages/console-app/src/stores/membersStore.ts`
- Delete: `packages/console-app/src/stores/auditStore.ts`
- Delete: `packages/console-app/src/stores/settingsStore.ts`
- Delete: `packages/console-app/src/api/client.ts`
- Modify: `packages/console-app/src/stores/index.ts`
- Modify: `packages/runtime/src/index.ts`
- Create: `packages/runtime/tests/runtime.test.ts`
- Create: `apps/web-shell/src/main.ts`
- Delete: `apps/web-shell/src/main.tsx`
- Modify: `apps/web-shell/package.json`
- Modify: `apps/web-shell/vite.config.ts`
- Modify: `apps/web-shell/tsconfig.json`
- Modify: `apps/web-shell/index.html`
- Create: `apps/desktop-shell/src/main.ts`
- Delete: `apps/desktop-shell/src/main.tsx`
- Modify: `apps/desktop-shell/package.json`
- Modify: `apps/desktop-shell/vite.config.ts`
- Modify: `apps/desktop-shell/tsconfig.json`
- Modify: `apps/desktop-shell/index.html`
- Modify: `apps/desktop-shell/src/main.css`
- Delete: `apps/desktop-shell/src/assets/react.svg`
- Delete: `packages/console-app/tests/*.test.tsx`
- Delete: `packages/console-app/tests/test-utils.tsx`
- Delete: `packages/console-app/tests/client.test.ts`
- Delete: `packages/console-app/tests/authStore.test.ts`
- Delete: `packages/console-app/tests/projectsStore.test.ts`
- Delete: `packages/console-app/tests/membersStore.test.ts`
- Delete: `packages/console-app/tests/auditStore.test.ts`
- Delete: `packages/console-app/tests/settingsStore.test.ts`
- Modify: `packages/console-app/tests/setup.ts`
- Modify: `package.json`
- Modify: `tsconfig.base.json`
- Modify: `tsconfig.json`
- Modify: `.oxlintrc.json`
- Modify: `turbo.json`
- Modify: `bun.lock`

**Interfaces:**
- Produces: public `createConsoleApp()` export consumed by both shells.
- Produces: Tauri `openExternal()` backed by `@tauri-apps/plugin-opener`.
- Produces: repository with zero React/TSX dependencies and zero old test harness files.

- [ ] **Step 1: Write the native runtime test**

```ts
it('delegates desktop external URLs to the injected opener', async () => {
  const openUrl = vi.fn(async () => undefined);
  const runtime = createDesktopRuntime({ openUrl });
  await runtime.openExternal('https://example.com');
  expect(openUrl).toHaveBeenCalledWith('https://example.com');
});
```

- [ ] **Step 2: Implement the public Vue entry and shell mounts**

`packages/console-app/src/index.ts`:

```ts
export { createConsoleApp } from './app/createConsoleApp';
export type { ConsoleAppOptions } from './app/createConsoleApp';
```

Each shell uses:

```ts
const apiBaseUrl = import.meta.env.VITE_ZIPSHIP_API_BASE_URL ?? 'http://localhost:5006';
createConsoleApp({ runtime, apiBaseUrl }).mount('#root');
```

Desktop imports `openUrl` from `@tauri-apps/plugin-opener` and passes it to:

```ts
createDesktopRuntime({ openUrl });
```

- [ ] **Step 3: Switch Vite and TypeScript configs to Vue only**

Remove React plugins and JSX options. Use `@vitejs/plugin-vue` in console/Web/desktop. Make Web and desktop typecheck scripts use `vue-tsc --noEmit`. Point HTML files at `/src/main.ts` and update the desktop title.

Ensure Tailwind scans `.vue` files and the desktop shell does not import the shared global stylesheet twice. Remove `@import "shadcn/tailwind.css"` from `index.css`; retain Tailwind, Geist, the existing tokens, and `.night`.

- [ ] **Step 4: Delete the old React source and tests**

Use `rg --files packages/console-app apps/web-shell apps/desktop-shell -g "*.tsx"` to produce the exact deletion audit, then remove every listed TSX file with `apply_patch`. Delete the old Zustand store modules and global API client only after their Vue consumers and tests have moved.

Keep the existing pure `.test.ts` files. Delete an old store/component test only when its Vue replacement from Tasks 3–12 exists and passes.

The baseline TSX deletion manifest is:

```text
apps/desktop-shell/src/main.tsx
apps/web-shell/src/main.tsx
packages/console-app/src/App.tsx
packages/console-app/src/components/ComingSoon.tsx
packages/console-app/src/components/ErrorBoundary.tsx
packages/console-app/src/components/ui/alert-dialog.tsx
packages/console-app/src/components/ui/alert.tsx
packages/console-app/src/components/ui/avatar-dropdown.tsx
packages/console-app/src/components/ui/avatar.tsx
packages/console-app/src/components/ui/badge.tsx
packages/console-app/src/components/ui/breadcrumb.tsx
packages/console-app/src/components/ui/button.tsx
packages/console-app/src/components/ui/card.tsx
packages/console-app/src/components/ui/checkbox.tsx
packages/console-app/src/components/ui/confirm-dialog.tsx
packages/console-app/src/components/ui/dialog.tsx
packages/console-app/src/components/ui/dropdown-menu.tsx
packages/console-app/src/components/ui/empty.tsx
packages/console-app/src/components/ui/field.tsx
packages/console-app/src/components/ui/input-group.tsx
packages/console-app/src/components/ui/input.tsx
packages/console-app/src/components/ui/item.tsx
packages/console-app/src/components/ui/label.tsx
packages/console-app/src/components/ui/navigation-menu.tsx
packages/console-app/src/components/ui/progress.tsx
packages/console-app/src/components/ui/scroll-area.tsx
packages/console-app/src/components/ui/select.tsx
packages/console-app/src/components/ui/separator.tsx
packages/console-app/src/components/ui/sheet.tsx
packages/console-app/src/components/ui/sidebar.tsx
packages/console-app/src/components/ui/skeleton.tsx
packages/console-app/src/components/ui/sonner.tsx
packages/console-app/src/components/ui/switch.tsx
packages/console-app/src/components/ui/table.tsx
packages/console-app/src/components/ui/tabs.tsx
packages/console-app/src/components/ui/textarea.tsx
packages/console-app/src/components/ui/tooltip.tsx
packages/console-app/src/features/layout/AppHeader.tsx
packages/console-app/src/features/layout/AppLayout.tsx
packages/console-app/src/features/layout/AppSidebar.tsx
packages/console-app/src/features/members/InviteMemberDialog.tsx
packages/console-app/src/features/project-detail/DeploymentConfirmDialog.tsx
packages/console-app/src/features/project-detail/ProjectActivityTab.tsx
packages/console-app/src/features/project-detail/ProjectDeploymentsTab.tsx
packages/console-app/src/features/project-detail/ProjectDetailHeader.tsx
packages/console-app/src/features/project-detail/ProjectMembersTab.tsx
packages/console-app/src/features/project-detail/ProjectPreviewPanel.tsx
packages/console-app/src/features/project-detail/ProjectProductionPanel.tsx
packages/console-app/src/features/project-detail/ProjectReleaseReport.tsx
packages/console-app/src/features/project-detail/ProjectSettingsTab.tsx
packages/console-app/src/features/project-detail/ProjectVersionsTab.tsx
packages/console-app/src/features/projects/CreateProjectDialog.tsx
packages/console-app/src/features/settings/ProfileEditDialog.tsx
packages/console-app/src/features/settings/SettingsDialog.tsx
packages/console-app/src/features/versions/UploadVersionDialog.tsx
packages/console-app/src/index.tsx
packages/console-app/src/pages/LoginPage.tsx
packages/console-app/src/pages/LogsPage.tsx
packages/console-app/src/pages/ProjectDetailPage.tsx
packages/console-app/src/pages/ProjectListPage.tsx
packages/console-app/src/pages/StoragePage.tsx
packages/console-app/src/router.tsx
packages/console-app/tests/AppHeader.test.tsx
packages/console-app/tests/AppSidebar.test.tsx
packages/console-app/tests/ComingSoon.test.tsx
packages/console-app/tests/DeploymentConfirmDialog.test.tsx
packages/console-app/tests/ProjectActivityTab.test.tsx
packages/console-app/tests/ProjectDeploymentsTab.test.tsx
packages/console-app/tests/ProjectDetailHeader.test.tsx
packages/console-app/tests/ProjectMembersTab.test.tsx
packages/console-app/tests/ProjectPreviewPanel.test.tsx
packages/console-app/tests/ProjectProductionPanel.test.tsx
packages/console-app/tests/ProjectSettingsTab.test.tsx
packages/console-app/tests/ProjectVersionsTab.test.tsx
packages/console-app/tests/test-utils.tsx
```

Re-run the audit immediately before deletion so newly introduced TSX files cannot escape the cleanup.

- [ ] **Step 5: Remove React dependencies and lint rules**

Remove these final dependencies/configuration references:

```text
react
react-dom
react-router
zustand
@base-ui/react
radix-ui
lucide-react
sonner
shadcn
@vitejs/plugin-react
@types/react
@types/react-dom
@testing-library/react
scheduler
```

Retain `@testing-library/jest-dom`. Remove the broken React `ui:add` command. Remove React Oxlint rules, enable Vue linting for `.vue`, and stop excluding the new project-owned UI directory from meaningful lint checks.

- [ ] **Step 6: Verify no React residue remains**

Run this Python-backed audit:

```python
from pathlib import Path

roots = [Path('packages/console-app'), Path('apps/web-shell'), Path('apps/desktop-shell')]
tsx = [p for root in roots for p in root.rglob('*.tsx')]
assert not tsx, tsx

needles = ['react', 'react-dom', 'react-router', 'zustand', '@base-ui/react', 'lucide-react']
for manifest in [Path('package.json'), *(root / 'package.json' for root in roots)]:
    if manifest.exists():
        text = manifest.read_text(encoding='utf-8').lower()
        for needle in needles:
            assert f'"{needle}"' not in text, (manifest, needle)
```

Expected: script exits successfully.

- [ ] **Step 7: Run package and shell verification**

Run: `bun install`

Run: `bun --filter @zipship/console-app test`

Run: `bun --filter @zipship/console-app typecheck`

Run: `bun --filter @zipship/web-shell typecheck`

Run: `bun --filter @zipship/web-shell build`

Run: `bun --filter @zipship/desktop-shell typecheck`

Run: `bun --filter @zipship/desktop-shell build`

Expected: all commands PASS.

- [ ] **Step 8: Commit the framework cutover**

```bash
git add package.json bun.lock turbo.json tsconfig.base.json tsconfig.json .oxlintrc.json packages/console-app packages/runtime apps/web-shell apps/desktop-shell
git commit -m "refactor(console): replace React with Vue"
```

---

### Task 14: Update Architecture Documentation and Run Final Quality Gates

**Files:**
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify or Delete: `packages/console-app/components.json`
- Modify: `apps/desktop-shell/README.md`
- Create: `tests/unit/vue-console-boundary.test.ts`

**Interfaces:**
- Produces: future repository guidance defaults to Vue 3, Pinia, Vue Router, VueUse, Vue SFCs, Tailwind v4, and the project-owned UI adapter boundary.
- Produces: automated regression guard against reintroducing React into the migrated frontend workspaces.

- [ ] **Step 1: Write the failing React residue regression test**

The test scans the three migrated workspaces and their manifests:

```ts
it('contains no React or TSX residue in migrated frontend workspaces', async () => {
  expect(findFiles('*.tsx')).toEqual([]);
  expect(findManifestDependencies(REACT_DEPENDENCIES)).toEqual([]);
});
```

It must report exact offending paths/dependencies when failing.

- [ ] **Step 2: Run the residue test**

Run: `bun test tests/unit/vue-console-boundary.test.ts`

Expected: PASS after Task 13; if it fails, remove the exact reported residue before continuing.

- [ ] **Step 3: Update documentation and component-generation policy**

Document:

```text
Vue 3 SFC + Composition API
Vue Router nested project routes
Pinia setup stores
VueUse for browser lifecycle capabilities
Tailwind CSS v4 with existing tokens and .night theme
components/ui as the only product-facing UI library boundary
@zipship/api-client and RuntimeAdapter injection through createConsoleApp
Vitest + Testing Library Vue + vue-tsc
```

Replace React examples and references. Configure `components.json` for the actual Vue UI directory only if its CLI is still used; otherwise delete it and remove the broken `ui:add` script.

- [ ] **Step 4: Run repository quality gates**

Run: `bun run lint`

Run: `bun run typecheck:workspaces`

Run: `bun run test:unit`

Run: `bun run build`

Expected: all commands PASS.

Run: `bun test`

Expected: PASS when Docker PostgreSQL is available. If Docker is unavailable, record the environment failure and retain successful unit/type/build results.

- [ ] **Step 5: Perform browser and desktop smoke tests**

Start the API and Web shell and verify:

```text
register/login -> project list -> create project -> project deep link
ZIP/folder/HTML upload -> processing poll -> release highlight
preview -> publish -> deployment history -> rollback
members/invitation -> role update/removal permission states
project settings -> profile -> theme -> language -> logout/revocation
desktop external links use the native opener
compact navigation opens, closes, and restores focus
```

Run a Tauri development smoke test when the Rust/WebView toolchain is available.

- [ ] **Step 6: Commit documentation and final guards**

```bash
git add AGENTS.md CLAUDE.md README.md packages/console-app apps/desktop-shell/README.md
git commit -m "docs: document Vue console architecture"
```

---

## Final Verification Checklist

- [ ] `rg --files packages/console-app apps/web-shell apps/desktop-shell -g "*.tsx"` returns no files.
- [ ] `rg -n "react|react-dom|react-router|zustand|@base-ui/react|lucide-react" package.json packages/console-app apps/web-shell apps/desktop-shell` returns no dependency/import matches.
- [ ] `rg -n "__ZIPSHIP_API_BASE_URL|treaty<App>" packages/console-app/src` returns no matches.
- [ ] `bun --filter @zipship/console-app test` passes.
- [ ] `bun --filter @zipship/console-app typecheck` passes.
- [ ] Web and desktop renderer typechecks/builds pass.
- [ ] Workspace lint, typecheck, unit tests, and build pass.
- [ ] Database-backed tests are run when Docker is available.
- [ ] Critical Web and Tauri smoke workflows pass.
