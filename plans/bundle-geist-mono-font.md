# Plan: Bundle Geist Mono Nerd Font

**Created**: 2026-04-09
**Branch**: main
**Status**: implemented

## Goal

Bundle the GeistMono Nerd Font Mono (all 9 weights) into gustav so the app renders correctly without requiring any system font installation. Replace all references to `CaskaydiaMono NF` with the bundled font.

## Acceptance Criteria

- [x] All 9 `GeistMonoNerdFontMono-*.otf` files exist in `src/renderer/assets/fonts/`
- [x] `@font-face` rules in `globals.css` declare each weight with correct `src` paths
- [x] `body` font-family in `globals.css` references `GeistMono Nerd Font Mono`
- [x] xterm.js `fontFamily` in `use-terminal.ts` references `GeistMono Nerd Font Mono`
- [x] `npm run build` succeeds and includes the font assets in the output

## Steps

### Step 1: Copy font files into the project

**Complexity**: trivial
**RED**: N/A — asset copy, no logic
**GREEN**: Copy all 9 `GeistMonoNerdFontMono-*.otf` files from `~/Downloads/GeistMono/` to `src/renderer/assets/fonts/`
**REFACTOR**: None needed
**Files**: `src/renderer/assets/fonts/GeistMonoNerdFontMono-*.otf`
**Commit**: `feat: add GeistMono Nerd Font Mono assets (all 9 weights)`

### Step 2: Add @font-face declarations and update font references

**Complexity**: trivial
**RED**: N/A — CSS/config changes, no testable logic
**GREEN**: Add `@font-face` rules for all 9 weights in `globals.css`, update `body` font-family to `'GeistMono Nerd Font Mono', monospace`
**REFACTOR**: None needed
**Files**: `src/renderer/styles/globals.css`
**Commit**: `feat: declare @font-face rules for bundled GeistMono font`

Font weight mapping:
| File | CSS font-weight |
|------|----------------|
| Thin | 100 |
| UltraLight | 200 |
| Light | 300 |
| Regular | 400 |
| Medium | 500 |
| SemiBold | 600 |
| Bold | 700 |
| Black | 800 |
| UltraBlack | 900 |

### Step 3: Update xterm.js font configuration

**Complexity**: trivial
**RED**: N/A — config value change
**GREEN**: Change `fontFamily` in `use-terminal.ts` from `'"CaskaydiaMono NF", "CaskaydiaMono Nerd Font", monospace'` to `'"GeistMono Nerd Font Mono", monospace'`
**REFACTOR**: None needed
**Files**: `src/renderer/hooks/use-terminal.ts`
**Commit**: `feat: use bundled GeistMono font in terminal`

### Step 4: Verify build

**Complexity**: trivial
**RED**: N/A
**GREEN**: Run `npm run build` — must succeed with font assets in output
**REFACTOR**: None needed
**Files**: None
**Commit**: N/A (verification only)

## Pre-PR Quality Gate

- [ ] All tests pass
- [ ] Type check passes (`npx tsc --noEmit`)
- [ ] `npm run build` succeeds
- [ ] Font assets present in build output

## Risks & Open Questions

- **OTF in Electron**: Chromium (Electron's renderer) supports OTF natively. No conversion to WOFF2 needed.
- **Vite asset handling**: Font files referenced via `url()` in CSS are automatically processed by Vite — no config changes required.
- **Font family name**: The actual font-family name embedded in the OTF metadata must match the CSS declaration. The Nerd Font Mono variant typically registers as `"GeistMono Nerd Font Mono"` — verify after bundling.
