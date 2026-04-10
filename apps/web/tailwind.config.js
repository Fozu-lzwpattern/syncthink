/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'st-indigo': '#4F46E5',
        'st-cyan': '#20c4cb',
        'st-bg': '#0f0f13',
        'st-surface': '#1a1a24',
        'st-border': '#2a2a38',
      },
    },
  },
  plugins: [],
}
