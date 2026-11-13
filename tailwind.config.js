/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
      },
      colors: {
        ink: {
          50: '#F1EFFA',
          100: '#E3DFF4',
          400: '#8B84B8',
          500: '#6B6690',
          700: '#2C2755',
          800: '#1E1B45',
          900: '#15132B',
          950: '#0D0C1C',
        },
        paper: '#FAF7F0',
        marigold: {
          400: '#F6BE62',
          500: '#F2A93B',
          600: '#DB8F1F',
        },
        lagoon: {
          400: '#48D6BE',
          500: '#2BB8A3',
          600: '#1E9586',
        },
        flare: {
          400: '#EF7D69',
          500: '#E8533F',
          600: '#CB3D2B',
        },
      },
      keyframes: {
        'stamp-in': {
          '0%': { transform: 'scale(2.2) rotate(-8deg)', opacity: '0' },
          '60%': { transform: 'scale(0.92) rotate(2deg)', opacity: '1' },
          '100%': { transform: 'scale(1) rotate(-3deg)', opacity: '1' },
        },
        'stamp-out': {
          '0%': { transform: 'scale(1) rotate(-3deg)', opacity: '1' },
          '100%': { transform: 'scale(0.9) rotate(-3deg)', opacity: '0' },
        },
        'rise-in': {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'ticket-in': {
          '0%': { transform: 'translateY(16px) scale(0.98)', opacity: '0' },
          '100%': { transform: 'translateY(0) scale(1)', opacity: '1' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%, 60%': { transform: 'translateX(-6px)' },
          '40%, 80%': { transform: 'translateX(6px)' },
        },
      },
      animation: {
        'stamp-in': 'stamp-in 0.45s cubic-bezier(.2,1.4,.4,1) forwards',
        'stamp-out': 'stamp-out 0.2s ease-in forwards',
        'rise-in': 'rise-in 0.3s ease-out forwards',
        'ticket-in': 'ticket-in 0.4s cubic-bezier(.2,.9,.3,1) forwards',
        shake: 'shake 0.4s ease-in-out',
      },
    },
  },
  plugins: [],
}
