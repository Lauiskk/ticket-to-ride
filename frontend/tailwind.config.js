/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Board game inspired palette
        board: {
          wood: '#8B5E3C',
          'wood-light': '#C4956A',
          'wood-dark': '#5C3D26',
          parchment: '#F5E6D3',
          'parchment-dark': '#E8D5BC',
          gold: '#D4A84B',
          'gold-light': '#F0D78C',
          crimson: '#B8292F',
          'crimson-dark': '#8B1A1F',
          navy: '#1B2838',
          'navy-light': '#2A3F56',
          emerald: '#2D6B4F',
          cream: '#FFFBF0',
        },
      },
      fontFamily: {
        display: ['"Playfair Display"', 'serif'],
        body: ['"Inter"', 'sans-serif'],
        ticket: ['"Courier Prime"', 'monospace'],
      },
      backgroundImage: {
        'wood-texture': "url('/textures/wood-bg.svg')",
        'parchment-texture': "url('/textures/parchment-bg.svg')",
      },
      boxShadow: {
        card: '0 4px 20px rgba(139, 94, 60, 0.15)',
        'card-hover': '0 8px 40px rgba(139, 94, 60, 0.25)',
        ticket: '4px 4px 0 rgba(27, 40, 56, 0.2)',
      },
      borderRadius: {
        card: '12px',
      },
      animation: {
        'float': 'float 6s ease-in-out infinite',
        'slide-up': 'slideUp 0.5s ease-out',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
