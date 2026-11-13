/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        space: {
          950: '#090C10',
          900: '#0D1117',
          850: '#161B22',
          800: '#1E2633',
          700: '#2A3649',
        },
        telemetry: {
          cyan: '#00F0FF',
          amber: '#FFB800',
          red: '#FF3366',
          green: '#00FF66',
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
