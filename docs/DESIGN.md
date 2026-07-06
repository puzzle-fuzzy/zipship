---
name: ZipShip
description: Self-hosted static artifact deployment platform
colors:
  primary: "#1a1a1a"
  primary-hover: "#333333"
  primary-active: "#000000"
  neutral-bg: "#ffffff"
  neutral-bg-subtle: "#f7f7f7"
  neutral-bg-tertiary: "#f0f0f0"
  neutral-text: "#1a1a1a"
  neutral-text-muted: "#6b6b6b"
  neutral-text-faint: "#9a9a9a"
  neutral-text-inverse: "#ffffff"
  neutral-border: "#e0e0e0"
  neutral-divider: "#e8e8e8"
  error: "#d32f2f"
  error-bg: "#fef2f2"
  success: "#2e7d32"
  success-bg: "#f0fdf0"
typography:
  display:
    fontFamily: "Inter4CJK, Inter, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "clamp(1.5rem, 3.5vw, 2rem)"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Inter4CJK, Inter, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter4CJK, Inter, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter4CJK, Inter, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.5
  mono:
    fontFamily: "SF Mono, Fira Code, Fira Mono, Menlo, Consolas, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "20px"
  6: "24px"
  8: "32px"
  10: "40px"
  12: "48px"
  16: "64px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral-text-inverse}"
    rounded: "{rounded.md}"
    padding: "0 20px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-primary-active:
    backgroundColor: "{colors.primary-active}"
  button-secondary:
    backgroundColor: "{colors.neutral-bg}"
    textColor: "{colors.neutral-text}"
    rounded: "{rounded.md}"
    border: "1px solid {colors.neutral-border}"
    padding: "0 20px"
    height: "40px"
  button-secondary-hover:
    backgroundColor: "{colors.neutral-bg-subtle}"
    border: "1px solid {colors.neutral-border-hover}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.neutral-text-muted}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-ghost-hover:
    backgroundColor: "{colors.neutral-bg-subtle}"
    textColor: "{colors.neutral-text}"
  input:
    backgroundColor: "{colors.neutral-bg}"
    textColor: "{colors.neutral-text}"
    rounded: "{rounded.md}"
    border: "1px solid {colors.neutral-border}"
    height: "40px"
    padding: "0 12px"
  input-focus:
    border: "1px solid {colors.neutral-text}"
  card:
    backgroundColor: "{colors.neutral-bg}"
    rounded: "{rounded.lg}"
    border: "1px solid {colors.neutral-border}"
    padding: "20px"
  dialog:
    backgroundColor: "{colors.neutral-bg}"
    rounded: "{rounded.xl}"
    border: "1px solid {colors.neutral-border}"
  badge-outline:
    backgroundColor: "transparent"
    textColor: "{colors.neutral-text-muted}"
    rounded: "999px"
    border: "1px solid {colors.neutral-border}"
    padding: "2px 8px"
  badge-success:
    backgroundColor: "{colors.success-bg}"
    textColor: "{colors.success}"
    rounded: "999px"
    padding: "2px 8px"
---

# Design System: ZipShip

## 1. Overview

**Creative North Star: "The Precision Deck"**

ZipShip's console is a clean, purposeful workspace for deploying static sites — a pilot's console, not a manager's dashboard. Every surface is restrained by default: warm off-whites, charcoal accents, crisp borders. The system communicates through typographic weight and spatial rhythm, not decorative color.

This is a **restrained palette with one committed accent**: near-black charcoal. The accent's job is to mark interactive truth — a button, an active tab, a focused input — not to decorate. Color is semantic, not ornamental.

The console explicitly rejects the visual language of AI tools (no blue or purple accents, no gradient text, no glassmorphism), the density of enterprise backends (no packed data tables, no heavy card grids), and the clichés of SaaS templates (no hero-metric sections, no numbered section markers, no tiny uppercase eyebrow over every heading).

**Key Characteristics:**
- **Charcoal anchor.** The single accent is near-black (#1a1a1a). No hue, no gradient, no blue.
- **Warm neutral canvas.** Off-white backgrounds with subtle tonal separation, not cold gray.
- **Type-driven hierarchy.** Scale + weight do the layout work; color accents are rare.
- **Flat-by-default.** Surfaces sit flat at rest. Shadows appear only for state changes and modal elevation.
- **Generous but precise spacing.** An 8px baseline grid with deliberate breathing room between sections.
- **Day and night as equals.** Both themes are first-class citizens, built from the same token system.

## 2. Colors

A warm-neutral palette anchored by a near-black accent. No hue competes with the content.

### Primary

- **Charcoal** (#1a1a1a): The single accent. Used for primary buttons, active tab indicators, focused borders, and interactive text (links, toggles). Never used as a decorative surface color - its job is to say "this is actionable."

- **Charcoal Hover** (#333333): Button hover state. A lifted dark gray that signals readiness without shifting hue.
- **Charcoal Active** (#000000): Button pressed state. True black for the moment of commitment.

### Neutral

- **White** (#ffffff): Primary surface. Used for page backgrounds, cards, dialogs, input fields.
- **Subtle Gray** (#f7f7f7): Secondary surface. The content area background behind cards, and the login page's brand panel.
- **Tertiary Gray** (#f0f0f0): Active/selected sidebar items and the base for avatar initials.
- **Hover Gray** (#f5f5f5): Hover state for clickable rows, sidebar items, and ghost buttons.

- **Ink** (#1a1a1a): Primary text. Full-weight body and headings.
- **Muted Ink** (#6b6b6b): Secondary text. Subtitles, descriptions, breadcrumb links.
- **Faint Ink** (#9a9a9a): Tertiary text. Placeholder text, metadata, timestamps.

- **Border** (#e0e0e0): Standard dividers and input strokes.
- **Divider** (#e8e8e8): Subtle separation between sidebar sections and dialog headers.

### Semantic

- **Error Red** (#d32f2f): Destructive actions and error states. Used sparingly for maximum attention.
- **Error Background** (#fef2f2): Soft pink tint behind error banners and danger items.
- **Success Green** (#2e7d32): Active/live badges and success indicators.
- **Success Background** (#f0fdf0): Soft green tint behind success badges.

### Named Rules

**The Charcoal Accent Rule.** The accent is never blue, purple, teal, or gradient. It is always a near-black neutral. This single constraint prevents the system from drifting into "AI tool" or "enterprise portal" territory.

**The One-Color Rule.** Any given screen uses at most two colors from the palette: a neutral background tone + the charcoal accent. Semantic colors (red, green) appear only in badges and toasts. If a screen needs a third color, the design is wrong — simplify.

## 3. Typography

**UI Font:** Inter4CJK (self-hosted WOFF2 with Google Fonts fallback)
**Monospace:** SF Mono, Fira Code, Menlo, Consolas
**Monospace:** SF Mono, Fira Code, Menlo, Consolas

**Character:** A single geometric sans-serif (Inter4CJK) handles all roles from display headlines to labels across both Latin and CJK text. No competing typefaces, no separate CJK fallback. The hierarchy comes entirely from weight (400 → 500 → 600 → 700) and size (11px → 32px). Inter4CJK is a fork of Inter that excludes CJK-ambiguous glyphs (quotes, dashes, ellipsis) — maintaining Inter's tight letterforms and generous x-height while preventing glyph interference in Chinese text.

### Hierarchy

- **Display** (Semibold 600, clamp(1.5rem, 3.5vw, 2rem), 1.25): Page titles and modal headers. Used once per view. `text-wrap: balance`.
- **Title** (Semibold 600, 1.125rem, 1.25): Card titles and section headings.
- **Body** (Normal 400, 0.875rem, 1.5): Primary reading size for tables, lists, forms. Max line length capped at 65–75ch.
- **Label** (Medium 500, 0.8125rem, 1.5): Form labels, button text, tab labels, breadcrumbs.
- **Caption** (Medium 500, 0.8125rem, 1.5): Status badges, metadata lines, timestamps, toast messages.
- **Mono** (Normal 400, 0.8125rem, 1.5): Code snippets, deploy URLs, release hashes.

### Named Rules

**The One-Family Rule.** Inter4CJK handles everything — Latin, CJK, display, body, labels, mono. No secondary display face, no serif accent, no brand typeface outside the app shell. A single loaded family eliminates FOUT, keeps the bundle lean, and guarantees visual cohesion across all 6 font sizes and 4 weights.

## 4. Elevation

The system uses a hybrid approach: **flat at rest, shadowed on interaction and overlay.**

Rest state surfaces sit flat — the card has a 1px border, no shadow. Depth is conveyed through tonal background separation (white card on subtle gray content area), not through elevation. This avoids the "floating card" problem where every surface competes for attention.

Shadows enter for three specific scenarios: elevated containers (dropdown menus, dialogs), state feedback (nothing at rest gets a shadow), and the toast stack (which slides above all content). The shadow scale is deliberately restrained — even the largest shadow (modal overlay) keeps blur at 40px and opacity at 10%.

### Shadow Vocabulary

- **Sm** (`0 1px 2px rgba(0,0,0,0.04)`): Subtle hover lift for interactive elements.
- **Md** (`0 2px 8px rgba(0,0,0,0.06)`): Dropdown menus and small elevated panels.
- **Lg** (`0 4px 20px rgba(0,0,0,0.08)`): Toast notifications and temporary overlays.
- **Xl** (`0 8px 40px rgba(0,0,0,0.10)`): Modal dialogs and full-screen overlays.

### Named Rules

**The Flat-By-Default Rule.** No surface has a shadow at rest. If it's not interactive and not an overlay, it doesn't float. A card with a 1px border and no shadow reads as a container; a card with a shadow reads as "pick me up." The second interpretation is almost never what the UI intends.

## 5. Components

### Buttons

- **Shape:** Gently rounded corners (6px radius). Pill shapes are reserved for badges only.
- **Primary:** Charcoal background (#1a1a1a), white text, 40px height, 20px horizontal padding. 150ms ease transition on background and border.
- **Primary Hover:** Lifted charcoal (#333333). Border shifts with background.
- **Primary Active:** True black (#000000). Moment of commitment.
- **Primary Disabled:** Full button at 0.5 opacity, `cursor: not-allowed`.

- **Secondary:** White background, charcoal text, 1px border (#e0e0e0), 40px height. Hover shifts background to subtle gray (#f5f5f5) and border to hover gray (#c0c0c0).
- **Ghost:** Transparent background, muted text (#6b6b6b), 32px height. Hover reveals subtle gray background and shifts text to primary.
- **Full-width:** Applied via modifier class. Used in login form for primary CTA.

- **Size variants:** `sm` (32px), `md` (40px, default), `lg` (48px). Padding scales proportionally.

### Cards / Containers

- **Corner Style:** Slightly rounded (8px radius).
- **Background:** White (--color-bg).
- **Border:** 1px solid border (#e0e0e0). No shadow at rest.
- **Internal Padding:** 20px body, 20px header with 0 bottom padding (header padding collapses into body flow).
- **Header:** Optional title (Semibold, 1.125rem) + description (Small, muted) on the left, optional action slot on the right.
- **Usage:** Project list, version list, settings panels. Cards contain related content; they are not decorative containers.

### Inputs / Fields

- **Style:** 1px border (#e0e0e0), white background, 6px radius, 40px height. Placeholder text at faint ink (#9a9a9a).
- **Focus:** Border shifts to charcoal + 1px box-shadow ring in charcoal. Focus indicator is always visible — no "focus glow" fade-in.
- **Error:** Border shifts to error red. Label and error message inherit error color.
- **Icon:** Optional left-positioned icon slot (mail, lock). Input text is inset 36px from left when icon is present.
- **Label:** 13px Medium weight, 4px gap above input.

### Dialogs

- **Overlay:** Fixed position, full inset, semi-transparent black at 30%, z-index 100. Clicking overlay closes dialog.
- **Container:** White background, 12px border-radius, 1px border, largest shadow (xl). Max-height 85vh with scrollable body.
- **Header:** 20px top/bottom padding × 24px horizontal padding, bottom-divider (1px, #e8e8e8). Title (Semibold, 1.125rem) + close button (28×28px, faint ink, hover reveals background).
- **Body:** 24px padding, scrollable overflow-y.

### Navigation (Sidebar)

- **Style:** Vertical sidebar, 260px wide, right-border divider. Logo + title in header with bottom-divider.
- **Items:** Full-width buttons, 12px padding, 6px radius. Hover shifts background to subtle gray; active/selected item uses tertiary gray background + medium weight text.
- **Project List:** Icon + name + status line per project. Truncated with ellipsis. "New Project" button at bottom of list area.
- **User Menu:** Footer section with top-divider. Avatar (initials, 36px round, tertiary gray background) + name + email + chevron. Wrapped in a dropdown that opens upward.

### Tabs

- **Style:** Horizontal list with bottom-border (1px, divider color). Each tab has 12px vertical × 20px horizontal padding, medium weight, muted text.
- **Active:** 2px charcoal bottom border, primary text weight.
- **Content:** Below the tab list, separated by standard flow spacing (20px).

### Badges

- **Style:** Pill-shaped (999px radius), 11px font, medium weight.
- **Outline:** Transparent background, muted text (#6b6b6b), 1px border (#e0e0e0). Default variant.
- **Success:** Green background tint (#f0fdf0), green text (#2e7d32). Used for "Live" status.
- **Default:** Charcoal background with white text. Rarely used.

### Toast / Notifications

- **Position:** Fixed top-right, z-index above all content.
- **Shape:** 8px radius, 1px border, lg shadow. Min-width 300px, max-width 380px.
- **Variants:** Left 3px border in semantic color (success=green, error=red, info=charcoal).
- **Entry:** Slide in from right (translateX 100% → 0) over 250ms ease-out. Exit: slide out over 200ms ease-in.
- **Content:** Icon + title (13px medium) + optional message (12px normal) + close button.

### Breadcrumb

- **Style:** Horizontal nav, 13px font. Items separated by "/" in faint ink.
- **Interactive items:** Muted text (#6b6b6b), hover transitions to primary.
- **Current item:** Primary text, medium weight, not clickable.

## 6. Do's and Don'ts

### Do:

- **Do** use charcoal (#1a1a1a) as the single accent color across buttons, tabs, focus rings, and links. Consistency builds trust.
- **Do** let typography do the hierarchy work — weight and size establish what's important, not color.
- **Do** keep surfaces flat at rest. A 1px border + tonal background separation is enough depth.
- **Do** use the full spacing scale deliberately. 24px between sections, 16px between related items, 8px between label and input.
- **Do** use semantic colors (red, green) only for their named purpose — never as decoration.
- **Do** treat day and night themes as equals. Both are designed from the same tokens, not one adapted from the other.

### Don't:

- **Don't** use blue, dark blue, blue-purple, or teal anywhere in the UI. This is a hard constraint — the system rejects the "AI tool" color family entirely.
- **Don't** use gradient text (`background-clip: text` with gradient). Emphasis comes from weight and size, not color transitions.
- **Don't** use glassmorphism (backdrop blur + semi-transparency) as a default surface treatment.
- **Don't** use side-stripe borders (colored `border-left` > 1px on cards or list items). Use full borders, background tints, or nothing.
- **Don't** over-round corners. Cards max out at 8px, dialogs at 12px, buttons at 6px. The 24px+ rounded card is an anti-pattern.
- **Don't** pair `border: 1px solid` with `box-shadow` blur ≥ 16px on the same element. Pick one — border OR shadow, never both as decoration.
- **Don't** create identical card grids (same-sized cards with icon + heading + text repeated across a section).
- **Don't** use the hero-metric template (big number, small label, gradient accent) — it reads as SaaS-template, not precision tool.
- **Don't** put a tiny uppercase tracked eyebrow above every section heading. One deliberate kicker is voice; repeating it on every section is AI grammar.
- **Don't** use numbered section markers (01 / 02 / 03) as default scaffolding.
