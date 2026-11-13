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
        // Neutral slate-navy scale, full range so no shade is ever missing
        // (a missing shade silently renders invisible text).
        ink: {
          50: '#F6F8FA',
          100: '#EBEFF3',
          200: '#D7DEE6',
          300: '#B7C2D0',
          400: '#8D9BAE',
          500: '#64748B',
          600: '#47566E',
          700: '#324256',
          800: '#1F2C3D',
          900: '#121B29',
          950: '#0A1420',
        },
        paper: '#F3F6F6', // faint pastel-teal tinted white, the light-mode surface
        // Primary accent — corporate teal (kept as "marigold" internally so
        // component class names didn't need to change).
        marigold: {
          50: '#E8F3F0',
          400: '#2E8F7E',
          500: '#146656',
          600: '#0E4F42',
        },
        // Secondary accent — muted steel-blue.
        lagoon: {
          50: '#EDF1F5',
          400: '#5E7A99',
          500: '#3E5872',
          600: '#2E4259',
        },
        // Error/warning — muted, not alarmist.
        flare: {
          50: '#FBEBE9',
          400: '#C65B52',
          500: '#A8392F',
          600: '#8A2D25',
        },
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '25%, 75%': { transform: 'translateX(-3px)' },
          '50%': { transform: 'translateX(3px)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-out forwards',
        shake: 'shake 0.25s ease-in-out',
      },
    },
  },
  plugins: [],
}
