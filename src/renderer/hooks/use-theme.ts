import { useEffect } from "react";
import type { ThemeColors } from "../../main/domain/types";

function darken(hex: string, amount: number): string {
	const n = parseInt(hex.replace("#", ""), 16);
	const r = Math.max(0, ((n >> 16) & 0xff) - amount);
	const g = Math.max(0, ((n >> 8) & 0xff) - amount);
	const b = Math.max(0, (n & 0xff) - amount);
	return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function applyThemeToDOM(c: ThemeColors) {
	const r = document.documentElement.style;
	const bg = c.background || "#282828";
	r.setProperty("--bg", darken(bg, 15));
	r.setProperty("--bg-surface", bg);
	r.setProperty("--fg", c.foreground || "#d4be98");
	r.setProperty("--accent", c.accent || "#7daea3");
	r.setProperty("--cursor", c.cursor || "#bdae93");
	r.setProperty("--sel-fg", c.selection_foreground || "#ebdbb2");
	r.setProperty("--sel-bg", c.selection_background || "#d65d0e");
	for (let i = 0; i <= 15; i++) {
		r.setProperty(`--c${i}`, c[`color${i}`] || "");
	}
}

export function xtermTheme(c: ThemeColors) {
	return {
		background: c.background,
		foreground: c.foreground,
		cursor: c.cursor,
		selectionBackground: c.selection_background,
		selectionForeground: c.selection_foreground,
		black: c.color0,
		red: c.color1,
		green: c.color2,
		yellow: c.color3,
		blue: c.color4,
		magenta: c.color5,
		cyan: c.color6,
		white: c.color7,
		brightBlack: c.color8,
		brightRed: c.color9,
		brightGreen: c.color10,
		brightYellow: c.color11,
		brightBlue: c.color12,
		brightMagenta: c.color13,
		brightCyan: c.color14,
		brightWhite: c.color15,
	};
}

export function useTheme() {
	useEffect(() => {
		// Initial theme
		window.api.getTheme().then(applyThemeToDOM);

		// Subscribe to updates
		const cleanup = window.api.onThemeUpdate(applyThemeToDOM);
		return cleanup;
	}, []);
}
