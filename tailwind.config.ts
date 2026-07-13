import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        element: {
          fire: "#e4572e",
          water: "#2e86e4",
          nature: "#3fae5c",
          lightning: "#f2c94c",
          dark: "#5b2e8f",
        },
      },
    },
  },
  plugins: [],
};

export default config;
