/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // MIQYAS brand — construction orange (site-vocabulary accent)
        // Dark mode uses orange; light mode uses mustard via CSS vars.
        mq: {
          50:  "#fff7ed",
          100: "#ffedd5",
          200: "#fed7aa",
          300: "#fdba74",
          400: "#fb923c",
          500: "#f97316",   // construction orange — primary brand
          600: "#ea580c",
          700: "#c2410c",
          800: "#9a3412",
          900: "#7c2d12",
          950: "#431407",
        },
        // Surface scale — warm steel (grounded in construction materials)
        surface: {
          50:  "#faf8f5",
          100: "#f3f0ea",
          200: "#e8e2d8",
          300: "#d4cbbf",
          400: "#b8a998",
          500: "#8f7f70",
          600: "#6b5d50",
          700: "#4a3f35",
          800: "#332d26",
          900: "#1f1a15",
          950: "#0e0b08",
        },
        // Site-specific slate — warm charcoal, not cold blue-gray
        slate: {
          700: "#4a3f35",   // borders, muted icons
          800: "#332d26",   // card surfaces
          850: "#2a241d",   // between 800/900
          900: "#1f1a15",   // deep panels
          925: "#1a1410",   // sidebar / topbar
          950: "#141008",   // page background
        },
        // Semantic site colors — construction vocabulary
        signal: {
          ahead:   "#4a9d6f",   // safe green — on schedule
          ontrack: "#f97316",   // orange — active, in progress
          behind:  "#d84141",   // critical red — act now
          warning: "#e8a932",   // safety amber — float running out
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
