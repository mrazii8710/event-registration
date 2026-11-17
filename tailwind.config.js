/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Inter', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
      },
      colors: {
        // Neutral slate scale. Full range, every shade actually used,
        // tuned so text/border pairs hit ~4.5:1+ contrast in both themes.
        ink: {
          50: '#F7F8FA',
          100: '#EEF1F4',
          200: '#DEE3E9',
          300: '#C3CBD4',
          400: '#8D98A8',
          500: '#64708A', // light-mode secondary text on white: ~4.9:1
          600: '#4A5570',
          700: '#313B52',
          800: '#1E2638', // dark-mode card surface
          900: '#141B2B', // dark-mode secondary surface / light-mode headings
          950: '#0B1220', // dark-mode page background
        },
        paper: '#F7F8FA', // light-mode page background
        // Single brand accent — teal, used consistently in both themes
        // (kept as "marigold" internally so component classNames didn't
        // need renaming across files).
        marigold: {
          50: '#E6F3EF',
          400: '#2EA98C', // dark-mode button fill (bright enough on #0B1220)
          500: '#0F6A58', // light-mode button fill (white text: ~5.3:1)
          600: '#0B5245',
        },
        // Secondary/info accent — muted steel-blue.
        lagoon: {
          50: '#EEF2F6',
          400: '#7089A8',
          500: '#44597A',
          600: '#334768',
        },
        // Error — muted red, readable on both light and dark surfaces.
        flare: {
          50: '#FBEAE8',
          400: '#E07A70',
          500: '#B3362B',
          600: '#8E2A21',
        },
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'toast-in': {
          '0%': { opacity: '0', transform: 'translateY(-10px) translateX(-50%)' },
          '100%': { opacity: '1', transform: 'translateY(0) translateX(-50%)' },
        },
        pulse-once: {
          '0%, 100%': { transform: 'scale(1)' },
          '40%': { transform: 'scale(1.18)' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '25%, 75%': { transform: 'translateX(-3px)' },
          '50%': { transform: 'translateX(3px)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.25s ease-out forwards',
        'toast-in': 'toast-in 0.25s cubic-bezier(.2,.8,.3,1) forwards',
        'pulse-once': 'pulse-once 0.35s ease-out',
        shake: 'shake 0.25s ease-in-out',
      },
    },
  },
  plugins: [],
}
