---
target: console-app (packages/console-app)
total_score: 23
p0_count: 0
p1_count: 3
p2_count: 2
timestamp: 2026-07-06T07-09-10Z
slug: packages-console-app
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3/4 | Loading states exist but no save confirmation on settings |
| 2 | Match System / Real World | 3/4 | Clean labels; "slug" is jargon for non-technical users |
| 3 | User Control and Freedom | 2/4 | No undo for logout; toasts have no auto-dismiss timer |
| 4 | Consistency and Standards | 3/4 | CSS modules and tokens used consistently; slight fragmentation in LoginPage inline styles |
| 5 | Error Prevention | 2/4 | No confirmation before logout/publish/rollback; email format not validated client-side |
| 6 | Recognition Rather Than Recall | 3/4 | Sidebar shows all projects, tabs indicate location |
| 7 | Flexibility and Efficiency | 1/4 | No keyboard shortcuts; no bulk operations (settings shows "coming soon") |
| 8 | Aesthetic and Minimalist Design | 3/4 | Clean layout; login brand panel is visually sparse |
| 9 | Error Recovery | 2/4 | Toasts and error banners exist but no inline field validation messages |
| 10 | Help and Documentation | 1/4 | No help, tooltips, or onboarding anywhere |
| **Total** | | **23/40** | **Acceptable** |

## Cognitive Load Assessment

- ✅ Single focus: Each page has one clear task
- ✅ Chunking: Content grouped into cards and tabs
- ✅ Grouping: Related items visually grouped
- ✅ Visual hierarchy: Title to content, clear
- ✅ One thing at a time
- ✅ Minimal choices: Never more than 2-4 options per screen
- ✅ Working memory: No cross-screen memory demands
- ✅ Progressive disclosure: Complexity revealed via tabs

**0 failures — low cognitive load.** This is a genuine strength.

## Anti-Patterns Verdict

**LLM assessment: Mostly clean, not AI-generated.** The warm neutral + charcoal palette avoids the blue/purple AI default. Layout is straightforward sidebar + content + dialogs with no gratuitous decoration. The interface reads as functional minimalism rather than "AI made this." The risk is the opposite direction: it could be mistaken for un-designed — the login page brand panel is sparse, the project detail settings tab is a plain field listing, and there is no visual signature element.

**Deterministic scan:** Found "overused font" (Inter/Inter4CJK) warnings x16 (intentional choice) and "em-dash overuse" in CSS comments (false positive).

## What's Working

1. **Cognitive load is genuinely low.** The sidebar + tabs + card pattern requires zero learning.
2. **The token system is coherent.** Colors, spacing, radii via CSS variables. Day/night theming well-implemented.
3. **The responsive sidebar fix.** Off-canvas drawer with overlay and Escape-key dismiss.

## Priority Issues

### [P1] No error recovery for destructive actions
Logout, publish, and rollback have no confirmation step. A single click executes immediately. Publish and rollback are irreversible actions that affect live sites. Fix: add confirmation dialog with `$impeccable harden`.

### [P1] Login page lacks brand presence
The login brand panel is a gray background with bullet features and no visual signature. For a ToC product, this is where trust starts. Fix: stronger brand mark, specific copy, subtle visual element with `$impeccable bolder`.

### [P1] No help or documentation anywhere
Zero help infrastructure. First-time users encountering "Slug" or "Release hash" have no way to understand these terms. Fix: tooltips, help menu, docs link with `$impeccable clarify`.

### [P2] Interface lacks motion feedback
Only animation is toast slide-in/out. Dialog appearing instantly feels jarring. Fix: fade-in dialogs, tab crossfade, page transitions with `$impeccable animate`.

### [P2] Project detail settings tab is a plain field dump
Read-only label-value pairs with no interactivity — the tab label "Settings" implies editable configuration. Fix: rename to "Info" or add inline editing with `$impeccable distill`.

## Persona Red Flags

### Alex (Power User)
- No keyboard shortcuts. Every action requires clicking.
- No bulk operations (batch archive, diff releases).
- No command palette or search navigation.

### Sam (Accessibility-Dependent)
- No Skip to Content link. Tab order not guaranteed.
- Sidebar and buttons rely on browser default focus rings.
- Toast notifications (transient) may be missed by screen readers.

### Jordan (Confused First-Timer)
- "Slug" is unexplained despite hint text.
- Empty states have no next-step guidance.
- "Settings" tab is read-only, conflicting with label expectation.

## Minor Observations
- Toast z-index 9999 should use a semantic scale value
- z-index 100 and 50 on overlay/dropdown should be tokenized
- Login registration mode lacks terms/conditions for production
- No favicon or title management
