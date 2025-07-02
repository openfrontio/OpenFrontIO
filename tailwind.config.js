/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{html,ts,js}"],
  theme: {
    extend: {
      colors: {
        primary: "var(--primary-color)",
        primaryLighter: "var(--primary-color-lighter)",
        backgroundDark: "var(--background-color-dark)",
        backgroundDarkLighter: "var(--background-color-dark-lighter)",
        backgroundGrey: "var(--background-color-grey)",
        textDark: "var(--text-color-dark)",
        textGrey: "var(--text-color-grey)",
        textLight: "var(--text-color-light)",
        green: "var(--green-color)",
        red: "var(--red-color)",
        orange: "var(--orange-color)",
        borderBase: "var(--border-color-base)",
      },
      fontSize: {
        base: "var(--font-size-base)",
        xsmall: "var(--font-size-xsmall)",
        small: "var(--font-size-small)",
        medium: "var(--font-size-medium)",
        large: "var(--font-size-large)",
        xlarge: "var(--font-size-xlarge)",
      },
      fontFamily: {
        base: "var(--font-family-base)",
        secondary: "var(--font-family-secondary)",
      },
      zIndex: {
        behind: "var(--z-index-behind)",
        base: "var(--z-index-base)",
        dropdown: "var(--z-index-dropdown)",
        modal: "var(--z-index-modal)",
        tooltip: "var(--z-index-tooltip)",
      },
      blur: {
        md: "var(--blur-md)",
      },
      transitionProperty: {
        base: "var(--transition-base)",
      },
      screens: {
        mobile: "576px",
        tablet: "800px",
        desktop: "1280px",
      },
    },
  },
  plugins: [],
  darkMode: "class",
};
