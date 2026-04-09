# Gustav

Electron app for managing terminal sessions and git worktrees, built with React + Tailwind 4.0 + shadcn/ui.

## Styling Rules

### Font Sizes

Never use absolute font sizes. This means:
- No `text-[Npx]` arbitrary pixel values
- No `font-size: Npx` in CSS or inline styles

Use Tailwind scale utilities (`text-xs`, `text-sm`, `text-base`, `text-lg`, `text-xl`, etc.) or `rem`-based values (`text-[0.85rem]`) when the scale doesn't have an exact match. The root font size is set as a percentage so the UI scales with user font preferences.

### Colors

Prefer shadcn semantic color tokens for UI components:
- `bg-background`, `text-foreground` (page-level bg/text)
- `bg-primary`, `text-primary-foreground` (primary actions)
- `bg-secondary`, `text-secondary-foreground` (secondary surfaces)
- `bg-muted`, `text-muted-foreground` (subdued areas)
- `bg-popover`, `text-popover-foreground` (dropdowns, dialogs)
- `bg-card`, `text-card-foreground` (card surfaces)
- `bg-destructive`, `text-destructive-foreground` (danger actions)
- `border-border`, `border-input`, `ring-ring` (borders and focus rings)

Use Omarchy theme palette tokens (`text-c0`..`text-c7`, `bg-c0`..`bg-c7`, `text-accent`, `bg-accent`, `text-fg`, `bg-bg`) only when you intentionally need a specific ANSI color — e.g., status indicators, syntax-like coloring, or terminal-adjacent UI.
