/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        panel: {
          950: '#0b1220',
          900: '#0f172a',
          800: '#111c33',
          700: '#182341',
        },
        // Theme-aware colors using CSS custom properties
        'bg-primary': 'rgb(var(--bg-primary) / <alpha-value>)',
        'bg-secondary': 'rgb(var(--bg-secondary) / <alpha-value>)',
        'bg-tertiary': 'rgb(var(--bg-tertiary) / <alpha-value>)',
        'bg-panel': 'rgb(var(--bg-panel) / <alpha-value>)',
        'text-primary': 'rgb(var(--text-primary) / <alpha-value>)',
        'text-secondary': 'rgb(var(--text-secondary) / <alpha-value>)',
        'text-muted': 'rgb(var(--text-muted) / <alpha-value>)',
        'border-primary': 'rgb(var(--border-primary))',
        'border-secondary': 'rgb(var(--border-secondary))',
        'accent-primary': 'rgb(var(--accent-primary) / <alpha-value>)',
        'accent-hover': 'rgb(var(--accent-hover) / <alpha-value>)',
        'accent-subtle': 'rgb(var(--accent-subtle))',
      },
    },
  },
  plugins: [],
}
