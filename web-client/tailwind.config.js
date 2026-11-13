/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        nasa: {
          black: '#000000',
          white: '#FFFFFF',
          carbon90: '#17171B',
          carbon80: '#2E2E32',
          carbon50: '#767676',
          blue: '#0B3D91',
          electric: '#288BFF',
          red: '#F64137',
          green: '#47DA84',
          amber: '#FFB800',
        },
        space: {
          950: '#000000',
          900: '#17171B',
          850: '#2E2E32',
          800: '#3E3E44',
          700: '#5A5A62',
        },
        telemetry: {
          cyan: '#288BFF',
          amber: '#FFB800',
          red: '#F64137',
          green: '#47DA84',
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        mono: ['"DM Mono"', '"JetBrains Mono"', 'ui-monospace', 'monospace'],
        sans: ['Inter', 'Public Sans Web', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
