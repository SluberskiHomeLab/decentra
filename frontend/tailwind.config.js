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
      },
    },
  },
  plugins: [],
}
