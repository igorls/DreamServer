/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        dream: {
          bg: "var(--dream-bg)",
          surface: "var(--dream-surface)",
          card: "var(--dream-card)",
          border: "var(--dream-border)",
          accent: "var(--dream-accent)",
          "accent-light": "var(--dream-accent-light)",
          purple: "var(--dream-purple)",
          lavender: "var(--dream-lavender)",
          success: "var(--dream-success)",
          muted: "var(--dream-muted)",
          "muted-dim": "var(--dream-muted-dim)",
          text: "var(--dream-text)",
          "text-secondary": "var(--dream-text-secondary)",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
      },
      animation: {
        "fade-in": "fadeIn 0.6s ease-out",
        "slide-up": "slideUp 0.5s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
