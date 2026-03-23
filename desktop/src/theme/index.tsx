import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";

// ── Theme definitions ────────────────────────────────────────────

export type ThemeId = "midnight" | "dark" | "dawn";

interface ThemeColors {
  bg: string;
  surface: string;
  card: string;
  border: string;
  accent: string;
  accentLight: string;
  purple: string;
  lavender: string;
  success: string;
  muted: string;
  mutedDim: string;
  text: string;
  textSecondary: string;
  glassBg: string;
  glassBorder: string;
}

const THEMES: Record<ThemeId, ThemeColors> = {
  midnight: {
    bg: "#0a0e27",
    surface: "#0f0d2e",
    card: "#1e1b4b",
    border: "#2e2a5e",
    accent: "#6366f1",
    accentLight: "#818cf8",
    purple: "#8b5cf6",
    lavender: "#c084fc",
    success: "#34d399",
    muted: "#94a3b8",
    mutedDim: "#64748b",
    text: "#ffffff",
    textSecondary: "#94a3b8",
    glassBg: "rgba(15, 13, 46, 0.65)",
    glassBorder: "rgba(255, 255, 255, 0.04)",
  },
  dark: {
    bg: "#09090b",
    surface: "#131316",
    card: "#1c1c22",
    border: "#27272a",
    accent: "#6366f1",
    accentLight: "#818cf8",
    purple: "#8b5cf6",
    lavender: "#c084fc",
    success: "#34d399",
    muted: "#a1a1aa",
    mutedDim: "#71717a",
    text: "#fafafa",
    textSecondary: "#a1a1aa",
    glassBg: "rgba(19, 19, 22, 0.7)",
    glassBorder: "rgba(255, 255, 255, 0.05)",
  },
  dawn: {
    bg: "#faf8f5",
    surface: "#f0ede8",
    card: "#ffffff",
    border: "#e5e2dc",
    accent: "#6366f1",
    accentLight: "#818cf8",
    purple: "#8b5cf6",
    lavender: "#c084fc",
    success: "#16a34a",
    muted: "#78716c",
    mutedDim: "#a8a29e",
    text: "#1c1917",
    textSecondary: "#78716c",
    glassBg: "rgba(255, 255, 255, 0.7)",
    glassBorder: "rgba(0, 0, 0, 0.06)",
  },
};

export const THEME_LABELS: Record<ThemeId, { icon: string }> = {
  midnight: { icon: "🌙" },
  dark: { icon: "🌑" },
  dawn: { icon: "🌅" },
};

// ── Apply theme to CSS custom properties ─────────────────────────

function applyTheme(id: ThemeId) {
  const colors = THEMES[id];
  const root = document.documentElement;

  root.setAttribute("data-theme", id);

  root.style.setProperty("--dream-bg", colors.bg);
  root.style.setProperty("--dream-surface", colors.surface);
  root.style.setProperty("--dream-card", colors.card);
  root.style.setProperty("--dream-border", colors.border);
  root.style.setProperty("--dream-accent", colors.accent);
  root.style.setProperty("--dream-accent-light", colors.accentLight);
  root.style.setProperty("--dream-purple", colors.purple);
  root.style.setProperty("--dream-lavender", colors.lavender);
  root.style.setProperty("--dream-success", colors.success);
  root.style.setProperty("--dream-muted", colors.muted);
  root.style.setProperty("--dream-muted-dim", colors.mutedDim);
  root.style.setProperty("--dream-text", colors.text);
  root.style.setProperty("--dream-text-secondary", colors.textSecondary);
  root.style.setProperty("--dream-glass-bg", colors.glassBg);
  root.style.setProperty("--dream-glass-border", colors.glassBorder);
}

// ── Context ──────────────────────────────────────────────────────

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (id: ThemeId) => void;
  themes: ThemeId[];
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// ── Provider ─────────────────────────────────────────────────────

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    const stored = localStorage.getItem("dreamserver-theme") as ThemeId | null;
    return stored && THEMES[stored] ? stored : "midnight";
  });

  const setTheme = useCallback((id: ThemeId) => {
    setThemeState(id);
    localStorage.setItem("dreamserver-theme", id);
    applyTheme(id);
  }, []);

  // Apply on mount
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return (
    <ThemeContext value={{ theme, setTheme, themes: Object.keys(THEMES) as ThemeId[] }}>
      {children}
    </ThemeContext>
  );
}

// ── Hook ─────────────────────────────────────────────────────────

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
