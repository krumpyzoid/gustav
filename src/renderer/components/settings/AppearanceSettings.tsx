import { useState, useEffect } from 'react';
import { Check } from 'lucide-react';

interface ThemeOption {
  slug: string;
  name: string;
  colors: { bg: string; fg: string; accent: string; c1: string; c2: string };
}

const THEMES: ThemeOption[] = [
  { slug: 'system', name: 'System (Omarchy)', colors: { bg: '#282828', fg: '#d4be98', accent: '#7daea3', c1: '#ea6962', c2: '#a9b665' } },
  { slug: 'light', name: 'Light', colors: { bg: '#fafafa', fg: '#383a42', accent: '#4078f2', c1: '#e45649', c2: '#50a14f' } },
  { slug: 'gruvbox-dark', name: 'Gruvbox Dark', colors: { bg: '#282828', fg: '#d4be98', accent: '#7daea3', c1: '#ea6962', c2: '#a9b665' } },
  { slug: 'nord', name: 'Nord', colors: { bg: '#2e3440', fg: '#d8dee9', accent: '#88c0d0', c1: '#bf616a', c2: '#a3be8c' } },
  { slug: 'rose-pine', name: 'Rosé Pine', colors: { bg: '#191724', fg: '#e0def4', accent: '#c4a7e7', c1: '#eb6f92', c2: '#31748f' } },
  { slug: 'claude', name: 'Claude', colors: { bg: '#FCF5EC', fg: '#40362B', accent: '#D97D3B', c1: '#C44D2B', c2: '#5E8A3C' } },
];

export function AppearanceSettings() {
  const [activeTheme, setActiveTheme] = useState('system');

  useEffect(() => {
    window.api.getPreferences().then((prefs: any) => {
      setActiveTheme(prefs.theme ?? 'system');
    });
  }, []);

  async function selectTheme(slug: string) {
    setActiveTheme(slug);
    await window.api.setPreference('theme', slug);
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-foreground mb-4">Appearance</h2>
      <p className="text-sm text-muted-foreground mb-6">Choose a color theme for the application.</p>

      <div className="grid grid-cols-2 gap-3">
        {THEMES.map((theme) => (
          <button
            key={theme.slug}
            onClick={() => selectTheme(theme.slug)}
            className={`relative flex flex-col gap-2 p-3 rounded-lg border-2 cursor-pointer transition-colors bg-transparent text-left ${
              activeTheme === theme.slug
                ? 'border-accent'
                : 'border-border hover:border-foreground/30'
            }`}
          >
            {activeTheme === theme.slug && (
              <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-accent flex items-center justify-center">
                <Check size={12} className="text-background" />
              </div>
            )}

            {/* Color swatch preview */}
            <div className="flex gap-1 h-6 rounded overflow-hidden">
              <div className="flex-1" style={{ backgroundColor: theme.colors.bg }} />
              <div className="flex-1" style={{ backgroundColor: theme.colors.accent }} />
              <div className="flex-1" style={{ backgroundColor: theme.colors.c1 }} />
              <div className="flex-1" style={{ backgroundColor: theme.colors.c2 }} />
              <div className="flex-1" style={{ backgroundColor: theme.colors.fg }} />
            </div>

            <span className="text-sm text-foreground">{theme.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
