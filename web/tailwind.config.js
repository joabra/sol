/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        night: '#0b1020',
        panel: '#131a2e',
        edge: '#22304f',
        solar: '#fbbf24',
        batt: '#34d399',
        grid: '#818cf8',
        loadc: '#f472b6',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
