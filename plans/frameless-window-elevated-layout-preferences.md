# Plan: Frameless Window, Elevated Layout & User Preferences

**Created**: 2026-04-12
**Branch**: main
**Status**: approved

## Goal

Transform Gustav's visual identity with three cohesive changes: (1) remove the native title bar for a frameless macOS window with integrated traffic lights, (2) create an elevated terminal layout where the sidebar is flat chrome and the terminal area feels raised, and (3) add a settings view accessible via a gear icon that replaces the main content with a preferences panel, starting with theme selection (System/Light/Dark + 5 curated themes).

## Acceptance Criteria

- [ ] No native macOS title bar; traffic lights integrated into sidebar header
- [ ] Sidebar header shows only `+` button and traffic lights (no "WORKSPACES" text)
- [ ] Window is draggable from sidebar header and tab bar area
- [ ] Sidebar is flat on window background (no rounding, no shadow)
- [ ] Terminal area is elevated (rounded corners, shadow, margin from edges)
- [ ] Tab bar is horizontally centered above the terminal
- [ ] xterm.js FitAddon correctly calculates dimensions in new layout
- [ ] Resize handle between sidebar and terminal still works
- [ ] Settings gear icon in sidebar opens a settings view
- [ ] Settings view: sidebar shows settings nav menu, body shows settings content
- [ ] Appearance section offers: System, Light, Dark, Gruvbox Dark, Nord, Catppuccin Mocha, Tokyo Night, Rose Pine
- [ ] "System" uses Omarchy file-watch (current behavior)
- [ ] Theme changes apply immediately and persist across restarts
- [ ] Preferences stored in `~/.local/share/gustav/preferences.json`

## Steps

### Step 1: Frameless window with traffic lights

**Complexity**: standard
**What**: Configure BrowserWindow for frameless macOS appearance. Add `titleBarStyle: 'hiddenInset'` and `trafficLightPosition`. Remove the `autoHideMenuBar` (irrelevant for frameless). The window content now extends to the top edge with traffic lights overlaid.
**Files**: `src/main/index.ts`
**Commit**: `feat: frameless macOS window with integrated traffic lights`

### Step 2: Minimal sidebar header with drag region

**Complexity**: standard
**What**: Remove the "Workspaces" text and ChevronDown from the sidebar header. Keep only the `+` button (right-aligned). Add top padding (~38px) to the sidebar to avoid overlapping traffic lights. Add `-webkit-app-region: drag` to the sidebar header area. Add `-webkit-app-region: no-drag` to the `+` button and its dropdown.
**Files**: `src/renderer/components/sidebar/Sidebar.tsx`
**Commit**: `feat: minimal sidebar header with drag region for traffic lights`

### Step 3: Elevated terminal layout

**Complexity**: standard
**What**: Restructure App.tsx layout. The outer container gets `bg-bg` as the window-level background. The terminal area (TabBar + terminal) gets wrapped in a container with `rounded-lg`, subtle shadow (`shadow-md` or `shadow-lg`), `bg-background`, and margins (top, right, bottom ~8px gap). The sidebar stays flat — flush to left/top/bottom edges, `bg-bg`, no rounding. Adjust the resize handle to work within the new margin model.
**Files**: `src/renderer/App.tsx`, `src/renderer/components/terminal/Terminal.tsx`, `src/renderer/styles/globals.css`
**Commit**: `feat: elevated terminal layout with flat sidebar chrome`

### Step 4: Center tab bar

**Complexity**: trivial
**What**: Change the TabBar flex container from left-aligned to centered (`justify-center`). Ensure the `+` button and add-input still work correctly at the end of the centered row.
**Files**: `src/renderer/components/terminal/TabBar.tsx`
**Commit**: `feat: horizontally center tab bar above terminal`

### Step 5: Add drag region to tab bar area

**Complexity**: trivial
**What**: Add `-webkit-app-region: drag` to the tab bar container or a wrapper above it, so users can drag the window from the top of the terminal area. Add `-webkit-app-region: no-drag` to the tab buttons and input.
**Files**: `src/renderer/components/terminal/TabBar.tsx`
**Commit**: `feat: make tab bar area draggable for window movement`

### Step 6: PreferenceService and IPC

**Complexity**: standard
**What**: Create `PreferenceService` in main process that reads/writes `~/.local/share/gustav/preferences.json`. Expose two IPC channels: `get-preferences` (returns full prefs object) and `set-preference` (takes key + value, writes to disk, returns updated prefs). Add channels to channels.ts, handlers to handlers.ts, and API methods to preload.ts. Preferences type starts with `{ theme?: string }`.
**Files**: `src/main/services/preference.service.ts` (new), `src/main/ipc/channels.ts`, `src/main/ipc/handlers.ts`, `src/preload/index.ts`, `src/main/domain/types.ts`
**Commit**: `feat: preference service with IPC for persistent user settings`

### Step 7: Built-in theme definitions

**Complexity**: standard
**What**: Create a themes module with color definitions for: Light, Dark, Gruvbox Dark (existing fallback), Nord, Catppuccin Mocha, Tokyo Night, Rose Pine. Each is a `ThemeColors` object with all 21 color keys. Export a `BUILT_IN_THEMES` map keyed by slug (`'light' | 'dark' | 'gruvbox-dark' | 'nord' | ...`).
**Files**: `src/main/domain/themes.ts` (new)
**Commit**: `feat: built-in theme definitions (7 themes)`

### Step 8: ThemeService integration with preferences

**Complexity**: standard
**What**: Update ThemeService to accept a theme preference. Add a `resolve(preference?: string)` method: if preference is a built-in theme slug, return that theme's colors; if `'system'` or undefined, load from Omarchy (current behavior). Update the `load()` call sites in handlers.ts and index.ts to pass through the preference. When preference is a built-in theme, skip Omarchy file-watching (or ignore its updates). Wire up preference changes to trigger theme updates via IPC.
**Files**: `src/main/services/theme.service.ts`, `src/main/ipc/handlers.ts`, `src/main/index.ts`
**Commit**: `feat: theme resolution with user preference override`

### Step 9: Settings view — layout toggle and sidebar nav

**Complexity**: complex
**What**: Add a `view` state to App.tsx: `'terminal' | 'settings'`. Add a gear icon button at the bottom of the Sidebar (next to "Clean worktrees"). Clicking it sets view to `'settings'`. When in settings view: the sidebar renders a settings navigation menu (back arrow at top, "Appearance" menu item) instead of the workspace tree. The body area renders a `SettingsView` component instead of the terminal. The terminal stays mounted but hidden (preserving PTY state). Create `src/renderer/components/settings/SettingsView.tsx` and `src/renderer/components/settings/SettingsSidebar.tsx`.
**Files**: `src/renderer/App.tsx`, `src/renderer/components/sidebar/Sidebar.tsx`, `src/renderer/components/settings/SettingsView.tsx` (new), `src/renderer/components/settings/SettingsSidebar.tsx` (new)
**Commit**: `feat: settings view with sidebar navigation toggle`

### Step 10: Appearance settings — theme picker

**Complexity**: standard
**What**: Create `AppearanceSettings` component rendered inside `SettingsView` when "Appearance" is selected. Shows a grid/list of theme options: "System (Omarchy)", "Light", "Dark", "Gruvbox Dark", "Nord", "Catppuccin Mocha", "Tokyo Night", "Rose Pine". Each option shows a color swatch preview (4-5 representative colors). The active theme has a visual indicator (border, checkmark). Clicking a theme calls `window.api.setPreference('theme', slug)` and the theme applies immediately. Add `getPreferences` and `setPreference` to the preload API types.
**Files**: `src/renderer/components/settings/AppearanceSettings.tsx` (new), `src/renderer/hooks/use-preferences.ts` (new)
**Commit**: `feat: theme picker in appearance settings with live preview`

## Pre-PR Quality Gate

- [ ] All tests pass
- [ ] Type check passes (`npx tsc --noEmit`)
- [ ] Linter passes
- [ ] App builds successfully (`npm run make`)
- [ ] Manual verification: frameless window, traffic lights, drag regions
- [ ] Manual verification: elevated terminal layout, centered tabs
- [ ] Manual verification: settings view toggle, theme selection, persistence

## Risks & Open Questions

- **Traffic light position**: `trafficLightPosition: { x: 16, y: 16 }` may need tuning after seeing the actual sidebar header padding — visual alignment is trial-and-error.
- **Drag regions**: `-webkit-app-region: drag` can interfere with click events if not scoped carefully. Every interactive element inside a drag region needs explicit `no-drag`.
- **xterm.js dimensions**: Adding margins/padding around the terminal container may cause FitAddon to miscalculate. Need to verify `ResizeObserver` triggers correctly after layout changes.
- **Theme file-watch lifecycle**: When switching from System to a built-in theme and back, the Omarchy file watcher needs clean start/stop logic to avoid stale listeners.
- **Hidden terminal in settings view**: Using `display: none` or `visibility: hidden` on the terminal while in settings view — need to confirm xterm.js doesn't break when hidden and re-shown.
