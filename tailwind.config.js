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
        // Neutral charcoal-navy, corporate rather than playful.
        ink: {
          50: '#F3F5F7',
          100: '#E5E9EE',
          400: '#8495A8',
          500: '#5B6B82',
          700: '#1F2F49',
          800: '#16243A',
          900: '#0F1B2D',
          950: '#0A1420',
        },
        paper: '#F6F7F9',
        // Primary accent — deep corporate teal (kept as "marigold" internally
        // so component class names didn't need to change).
        marigold: {
          400: '#2E8F7E',
          500: '#146656',
          600: '#0E4F42',
        },
        // Secondary accent — muted steel-blue.
        lagoon: {
          400: '#5E7A99',
          500: '#3E5872',
          600: '#2E4259',
        },
        // Error/warning — muted, not alarmist.
        flare: {
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
