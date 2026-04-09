# Plan: Introduce shadcn Semantic Colors & Enforce Relative Font Sizing

**Created**: 2026-04-09
**Branch**: main
**Status**: implemented

## Goal

The shadcn UI components (`button`, `dialog`, `input`, `select`, `checkbox`, `label`) reference semantic color tokens (`primary`, `secondary`, `muted`, `background`, `foreground`, `input`, `ring`, `popover`, `card`, `accent-foreground`, etc.) that **do not exist** in `globals.css`. This means those components silently fall back to Tailwind defaults, breaking visual consistency with the dynamic Omarchy theme.

This plan introduces shadcn semantic color tokens in the `@theme` block, mapping them to the existing dynamic theme variables (e.g., `--color-background` → `var(--bg)`), so shadcn components render correctly within the theme. The existing `--color-bg`, `--color-fg`, `--color-c0`–`--color-c7` tokens are preserved unchanged.

Additionally, all absolute `px` font sizes in component code are replaced with Tailwind scale utilities (`text-xs`, `text-sm`, etc.) or `rem`-based values, and the `html` root size is converted to a percentage so the entire UI scales with user font preferences.

## Acceptance Criteria

- [ ] All existing theme tokens (`--color-bg`, `--color-fg`, `--color-accent`, `--color-c0`–`--color-c7`, `--color-destructive`) remain in `@theme` and continue to work
- [ ] shadcn semantic tokens (`background`, `foreground`, `primary`, `secondary`, `muted`, `accent`, `popover`, `card`, `input`, `ring`, `border`, `destructive` + their `-foreground` variants) are defined in `@theme`, mapping to the existing dynamic CSS variables
- [ ] shadcn UI components render with the correct theme colors (no Tailwind default fallbacks)
- [ ] No absolute `px` font sizes remain in any `.tsx` component file (no `text-[Npx]`, no inline `font-size: Npx`)
- [ ] The `html` root font size uses a percentage or rem value (not `13px`)
- [ ] A CLAUDE.md directive exists forbidding absolute font sizes
- [ ] All existing functionality still works — no visual regressions beyond intentional color corrections

## Steps

### Step 1: Define shadcn semantic color tokens in globals.css

**Complexity**: standard
**RED**: Write a test (or verification script) that asserts all required shadcn CSS custom properties exist on `:root` after theme loads. Specifically check for: `--color-background`, `--color-foreground`, `--color-primary`, `--color-primary-foreground`, `--color-secondary`, `--color-secondary-foreground`, `--color-muted`, `--color-muted-foreground`, `--color-accent-foreground`, `--color-popover`, `--color-popover-foreground`, `--color-card`, `--color-card-foreground`, `--color-border`, `--color-input`, `--color-ring`.
**GREEN**: Add the semantic tokens to the `@theme` block in `globals.css`, mapping them to existing dynamic variables. Proposed mapping:

```
--color-background: var(--bg, #282828)        /* same as --color-bg */
--color-foreground: var(--fg, #d4be98)        /* same as --color-fg */
--color-primary: var(--accent, #7daea3)       /* accent = primary action color */
--color-primary-foreground: var(--bg, #282828) /* dark text on primary */
--color-secondary: var(--c7, #d4be98)         /* lighter surface */
--color-secondary-foreground: var(--bg, #282828) /* dark text on light surface */
--color-muted: var(--c0, #3c3836)             /* subdued backgrounds */
--color-muted-foreground: var(--fg, #d4be98)  /* dim at usage site with opacity */
--color-accent-foreground: var(--bg, #282828) /* dark text on accent highlight */
--color-popover: var(--bg, #282828)           /* popover/dropdown bg */
--color-popover-foreground: var(--fg, #d4be98)
--color-card: var(--bg, #282828)
--color-card-foreground: var(--fg, #d4be98)
--color-border: var(--c0, #3c3836)
--color-input: var(--c0, #3c3836)
--color-ring: var(--accent, #7daea3)
```

Note: `--color-accent` already exists and maps to the theme accent. shadcn uses `accent` for hover highlights — the existing mapping works. We only need to add `--color-accent-foreground`.

**REFACTOR**: Review for any duplicate/redundant token definitions.
**Files**: `src/renderer/styles/globals.css`
**Commit**: `feat: add shadcn semantic color tokens mapped to dynamic theme`

### Step 2: Convert html root font size from absolute px to relative unit

**Complexity**: trivial
**RED**: Verify `html { font-size: 13px; }` exists and is absolute.
**GREEN**: Replace `font-size: 13px` with `font-size: 81.25%` (13/16 = 0.8125 — scales relative to browser default 16px, yielding 13px equivalent).
**REFACTOR**: None needed.
**Files**: `src/renderer/styles/globals.css`
**Commit**: `fix: use relative font-size on html root for scalability`

### Step 3: Replace arbitrary px font sizes in components with scale/rem values

**Complexity**: standard
**RED**: Grep for `text-\[\d+px\]` across all `.tsx` files and assert zero matches.
**GREEN**: Replace each occurrence:

| File | Current | Replacement | Rationale |
|------|---------|-------------|-----------|
| `AccordionCategory.tsx:18` | `text-[11px]` | `text-xs` (0.75rem ≈ 9.75px at 13px root; close enough) or custom `text-[0.846rem]` (11/13) | Keep visual parity |
| `CleanWorktreesDialog.tsx:73,75` | `text-[10px]` | `text-xs` or `text-[0.769rem]` (10/13) | Badge text |
| `CleanWorktreesDialog.tsx:96` | `text-[11px]` | `text-xs` or `text-[0.846rem]` | Section header |

Decision: use `text-xs` for all — approved by user.

**REFACTOR**: None needed.
**Files**: `src/renderer/components/sidebar/AccordionCategory.tsx`, `src/renderer/components/dialogs/CleanWorktreesDialog.tsx`
**Commit**: `fix: replace absolute px font sizes with relative scale values`

### Step 4: Add CLAUDE.md directive forbidding absolute font sizes

**Complexity**: trivial
**RED**: Check that no CLAUDE.md exists at project root (confirmed — none exists).
**GREEN**: Create `CLAUDE.md` with a styling rules section that includes:
- Never use absolute font sizes (`text-[Npx]`, `font-size: Npx`). Use Tailwind scale utilities (`text-xs`, `text-sm`, `text-base`, `text-lg`, etc.) or `rem`-based values.
- Prefer shadcn semantic color tokens (`bg-background`, `text-foreground`, `bg-primary`, `text-muted-foreground`, etc.) for UI components. Use theme tokens (`bg-bg`, `text-fg`, `text-c0`–`text-c7`, `bg-accent`) when directly referencing the Omarchy palette.
**REFACTOR**: None needed.
**Files**: `CLAUDE.md`
**Commit**: `docs: add CLAUDE.md with styling directives`

### Step 5: Migrate custom-styled components to prefer shadcn semantic tokens where appropriate

**Complexity**: standard
**RED**: Identify components that use `bg-bg`, `text-fg`, `border-c0` etc. where the shadcn semantic equivalent (`bg-background`, `text-foreground`, `border-border`) would be more appropriate. Write a checklist of conversions.
**GREEN**: Update class names in dialog, sidebar, and tab components to prefer semantic tokens. Examples:
- `bg-bg` → `bg-background` (equivalent)
- `text-fg` → `text-foreground` (equivalent)  
- `border-c0` → `border-border` (equivalent)
- `bg-c0` (used as muted surface) → `bg-muted`
- Keep direct palette references (`text-c1`, `text-c2`, `text-c3`, `text-c5`, `text-accent`, `bg-c1/10`) where the specific ANSI color is intentional (status indicators, syntax-like coloring).
**REFACTOR**: Ensure no visual regressions — semantic tokens should resolve to the same values.
**Files**: `src/renderer/components/sidebar/*.tsx`, `src/renderer/components/dialogs/*.tsx`, `src/renderer/components/terminal/TabBar.tsx`
**Commit**: `refactor: prefer shadcn semantic color tokens in components`

## Complexity Classification

| Step | Rating | Rationale |
|------|--------|-----------|
| 1 | standard | New CSS tokens in existing theme block; must validate mapping correctness |
| 2 | trivial | Single-line CSS change |
| 3 | standard | Multi-file find-and-replace with judgment calls on sizing |
| 4 | trivial | New documentation file |
| 5 | standard | Multi-file class name updates; must preserve visual parity |

## Pre-PR Quality Gate

- [ ] All tests pass
- [ ] Type check passes
- [ ] Linter passes
- [ ] `/code-review --changed` passes
- [ ] No `text-[Npx]` patterns remain in `.tsx` files
- [ ] All shadcn UI components render with theme colors (manual visual check)
- [ ] CLAUDE.md directives in place

## Risks & Open Questions

- **No automated visual regression tests**: The project has no screenshot/visual test suite, so color and size changes need manual verification.

## Resolved Decisions

- **secondary**: maps to `c7` (lighter) — approved
- **muted-foreground**: maps to raw `--fg`, dimmed at usage site with opacity — approved
- **Font sizes**: `text-xs` for all `text-[10px]` / `text-[11px]` replacements — approved
