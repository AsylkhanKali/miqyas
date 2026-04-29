/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // MIQYAS brand — vibrant construction-grade palette
        mq: {
          50:  "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
          950: "#172554",
        },
        // Surface scale — charcoal with blue undertone (lighter than before)
        surface: {
          50:  "#f8fafc",
          100: "#f1f5f9",
          200: "#e2e8f0",
          300: "#cbd5e1",
          400: "#94a3b8",
          500: "#64748b",
          600: "#475569",
          700: "#334155",
          800: "#1e293b",
          900: "#0f172a",
          950: "#070e1d",
        },
        // Override dark-end slate shades to be brighter / more readable
        slate: {
          700: "#3a506b",   // borders, muted icons (was #334155, now slightly lighter)
          800: "#263347",   // card surfaces (was #1e293b)
          850: "#1f2d40",   // between 800/900 (new)
          900: "#1a2842",   // deeper panels (was #0f172a)
          925: "#16213a",   // sidebar / topbar
          950: "#0d1526",   // page background
        },
        signal: {
          ahead:   "#10b981",
          ontrack: "#3b82f6",
          behind:  "#ef4444",
          warning: "#f59e0b",
        },
      },
      fontFamily: {
        sans:    ['"DM Sans"', "system-ui", "sans-serif"],
        display: ['"Instrument Sans"', '"DM Sans"', "sans-serif"],
        mono:    ['"JetBrains Mono"', "monospace"],
      },
      fontSize: {
        "2xs": ["0.65rem", { lineHeight: "0.85rem" }],
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
      },
      animation: {
        "fade-in":       "fadeIn 0.5s ease-out",
        "slide-up":      "slideUp 0.4s ease-out",
        "slide-in-right":"slideInRight 0.3s ease-out",
        "pulse-subtle":  "pulseSubtle 2s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          "0%":   { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%":   { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideInRight: {
          "0%":   { opacity: "0", transform: "translateX(12px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        pulseSubtle: {
          "0%, 100%": { opacity: "1" },
          "50%":      { opacity: "0.7" },
        },
      },
    },
  },
  plugins: [],
};
