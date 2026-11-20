/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Baloo 2"', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
      },
      colors: {
        // Woodland/parchment scale — deep forest green through warm tan,
        // standing in for the old neutral slate (same class names, new
        // hues, so components didn't need renaming).
        ink: {
          50: '#F3EEDC',
          100: '#E8DFC3',
          200: '#D6C9A0',
          300: '#BFAF85',
          400: '#8C8360',
          500: '#6B6246', // secondary text on parchment: ~5.2:1
          600: '#4F4A36',
          700: '#3A4A3C',
          800: '#2B4332', // dark-mode card surface / sidebar
          900: '#223429', // dark-mode secondary surface
          950: '#182419', // dark-mode page background
        },
        paper: '#F4ECDA', // light-mode page background — warm parchment
        cream: '#FBF6EA', // light-mode card surface — lighter parchment
        // Primary accent — moss/forest green, used consistently in both
        // themes (kept as "marigold" internally so component classNames
        // didn't need renaming).
        marigold: {
          50: '#EAF0E1',
          400: '#8FB36B', // dark-mode button fill (bright enough on #182419)
          500: '#4F7A3D', // light-mode button fill (white text: ~4.8:1)
          600: '#3F6530',
        },
        // Secondary/info accent — warm gold-tan.
        lagoon: {
          50: '#F7EFDD',
          400: '#D8B35C',
          500: '#B8903A',
          600: '#95732C',
        },
        // Error — muted berry red, readable on both light and dark surfaces.
        flare: {
          50: '#F7E6E2',
          400: '#C97A66',
          500: '#A6432C',
          600: '#853423',
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
        'pulse-once': {
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
