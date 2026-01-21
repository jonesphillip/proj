/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  safelist: [
    // Accent color utilities used in dynamic lookups (SEGMENT_COLORS, EDGE_COLOR, etc.)
    { pattern: /bg-accent-.+/ },
    { pattern: /text-accent-.+/ },
    { pattern: /border-l-accent-.+/ },
  ],
  theme: {
    extend: {
      colors: {
        terminal: {
          bg: '#0d0d0d',
          surface: '#141414',
          border: '#262626',
          muted: '#525252',
          text: '#d4d4d4',
          secondary: '#737373',
          raised: '#1e1e1e',
        },
        accent: {
          primary: '#9B8EC4',
          green: '#22c55e',
          cyan: '#06b6d4',
          amber: '#eab308',
          red: '#ef4444',
          magenta: '#a855f7',
          blue: '#3b82f6',
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'SF Mono', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      borderRadius: {
        none: '0',
        sm: '2px',
        DEFAULT: '2px',
        md: '2px',
        lg: '2px',
        xl: '2px',
        '2xl': '2px',
        '3xl': '2px',
        full: '9999px',
      },
    },
  },
  plugins: [],
};
