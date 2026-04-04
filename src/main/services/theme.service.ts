import { join } from 'node:path';
import { homedir } from 'node:os';
import type { FileSystemPort } from '../ports/filesystem.port';
import type { ThemeColors } from '../domain/types';

const THEME_DIR = join(homedir(), '.config/omarchy/current/theme');
const COLORS_TOML = join(THEME_DIR, 'colors.toml');
const GHOSTTY_CONF = join(THEME_DIR, 'ghostty.conf');

const FALLBACK_THEME: ThemeColors = {
  accent: '#7daea3', cursor: '#bdae93', foreground: '#d4be98',
  background: '#282828', selection_foreground: '#ebdbb2',
  selection_background: '#d65d0e',
  color0: '#3c3836', color1: '#ea6962', color2: '#a9b665',
  color3: '#d8a657', color4: '#7daea3', color5: '#d3869b',
  color6: '#89b482', color7: '#d4be98', color8: '#3c3836',
  color9: '#ea6962', color10: '#a9b665', color11: '#d8a657',
  color12: '#7daea3', color13: '#d3869b', color14: '#89b482',
  color15: '#d4be98',
};

export class ThemeService {
  private lastJson = '';
  private listener: ((colors: ThemeColors) => void) | null = null;

  constructor(private fs: FileSystemPort) {}

  load(): ThemeColors {
    // Try colors.toml first
    try {
      const raw = require('node:fs').readFileSync(COLORS_TOML, 'utf-8');
      const colors: ThemeColors = {};
      for (const line of raw.split('\n')) {
        const m = line.match(/^(\w+)\s*=\s*"([^"]+)"/);
        if (m) colors[m[1]] = m[2];
      }
      if (Object.keys(colors).length > 0) return colors;
    } catch {}

    // Fall back to ghostty.conf
    try {
      const raw = require('node:fs').readFileSync(GHOSTTY_CONF, 'utf-8');
      const colors: ThemeColors = {};
      for (const line of raw.split('\n')) {
        const m = line.match(/^(\S+)\s*=\s*(.+)/);
        if (!m) continue;
        const [, key, val] = m;
        const v = val.trim();
        if (key === 'background') colors.background = v;
        else if (key === 'foreground') colors.foreground = v;
        else if (key === 'cursor-color') colors.cursor = v;
        else if (key === 'selection-background') colors.selection_background = v;
        else if (key === 'selection-foreground') colors.selection_foreground = v;
        else if (key.startsWith('palette')) {
          const pm = v.match(/^(\d+)=(#\w+)/);
          if (pm) colors[`color${pm[1]}`] = pm[2];
        }
      }
      if (!colors.accent) colors.accent = colors.color4 || '#7daea3';
      if (Object.keys(colors).length > 0) return colors;
    } catch {}

    return { ...FALLBACK_THEME };
  }

  onChange(listener: (colors: ThemeColors) => void): void {
    this.listener = listener;
  }

  sendIfChanged(): void {
    const colors = this.load();
    const json = JSON.stringify(colors);
    if (json !== this.lastJson) {
      this.lastJson = json;
      this.listener?.(colors);
    }
  }

  startWatching(): void {
    this.lastJson = JSON.stringify(this.load());

    this.fs.watch(THEME_DIR, { recursive: true }, () => {
      setTimeout(() => this.sendIfChanged(), 300);
    });

    // Watch parent dir to catch theme dir replacement
    const { dirname } = require('node:path');
    this.fs.watch(dirname(THEME_DIR), {}, () => {
      setTimeout(() => this.sendIfChanged(), 300);
    });
  }
}
