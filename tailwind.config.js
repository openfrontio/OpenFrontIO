// tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{html,ts,js}"],
  theme: {
    extend: {
      keyframes: {
        rainbow: {
          "0%, 100%": { backgroundColor: "#990033" },
          "16%": { backgroundColor: "#996600" },
          "32%": { backgroundColor: "#336600" },
          "48%": { backgroundColor: "#008080" },
          "64%": { backgroundColor: "#1c3f99" },
          "80%": { backgroundColor: "#5e0099" },
        },
        brightRainbow: {
          "0%, 100%": { backgroundColor: "#ff0000" }, // Red
          "16%": { backgroundColor: "#ffa500" }, // Orange
          "32%": { backgroundColor: "#ffff00" }, // Yellow
          "48%": { backgroundColor: "#00ff00" }, // Green
          "64%": { backgroundColor: "#00ffff" }, // Cyan
          "80%": { backgroundColor: "#0000ff" }, // Blue
        },
        copperGlow: {
          "0%, 100%": { backgroundColor: "#b87333", filter: "brightness(1)" },
          "50%": { backgroundColor: "#cd7f32", filter: "brightness(1.4)" },
        },
        silverGlow: {
          "0%, 100%": { backgroundColor: "#c0c0c0", filter: "brightness(1)" },
          "50%": { backgroundColor: "#e0e0e0", filter: "brightness(1.5)" },
        },
        goldGlow: {
          "0%, 100%": { backgroundColor: "#ffd700", filter: "brightness(1)" },
          "50%": { backgroundColor: "#fff8dc", filter: "brightness(1.6)" },
        },
        neonPulseGreen: {
          "0%, 100%": {
            backgroundColor: "#39ff14",
            boxShadow: "0 0 4px #39ff14, 0 0 8px #39ff14",
            filter: "brightness(1)",
            transform: "scale(1)",
            opacity: "1",
          },
          "25%, 75%": {
            backgroundColor: "#2aff60",
            boxShadow: "0 0 8px #2aff60, 0 0 12px #2aff60",
            filter: "brightness(1.2)",
            transform: "scale(1.05)",
            opacity: "0.9",
          },
          "50%": {
            backgroundColor: "#00ff88",
            boxShadow: "0 0 12px #00ff88, 0 0 20px #00ff88",
            filter: "brightness(1.4)",
            transform: "scale(1.12)",
            opacity: "0.7",
          },
        },
        waterFlicker: {
          "0%, 100%": {
            transform: "translateY(0px) scale(1)",
            filter: "brightness(1)",
            opacity: "0.9",
            backgroundColor: "#00bfff",
          },
          "12%": {
            transform: "translateY(-1px) scale(1.01)",
            filter: "brightness(1.05)",
            opacity: "0.95",
            backgroundColor: "#1e90ff",
          },
          "27%": {
            transform: "translateY(1px) scale(1.02)",
            filter: "brightness(1.15)",
            opacity: "1",
            backgroundColor: "#87cefa",
          },
          "45%": {
            transform: "translateY(-0.5px) scale(1.01)",
            filter: "brightness(1.05)",
            opacity: "0.93",
            backgroundColor: "#4682b4",
          },
          "63%": {
            transform: "translateY(0.7px) scale(1.03)",
            filter: "brightness(1.2)",
            opacity: "1",
            backgroundColor: "#87cefa",
          },
          "80%": {
            transform: "translateY(-1px) scale(1)",
            filter: "brightness(1)",
            opacity: "0.88",
            backgroundColor: "#1e90ff",
          },
        },
        lavaFlow: {
          "0%": {
            backgroundColor: "#ff4500",
            filter: "brightness(1.1)",
            transform: "scale(1)",
          },
          "20%": {
            backgroundColor: "#ff6347",
            filter: "brightness(1.2)",
            transform: "scale(1.02)",
          },
          "40%": {
            backgroundColor: "#ff8c00",
            filter: "brightness(1.3)",
            transform: "scale(1.03)",
          },
          "60%": {
            backgroundColor: "#ff4500",
            filter: "brightness(1.4)",
            transform: "scale(1.01)",
          },
          "80%": {
            backgroundColor: "#ff0000",
            filter: "brightness(1.2)",
            transform: "scale(1)",
          },
          "100%": {
            backgroundColor: "#ff4500",
            filter: "brightness(1.1)",
            transform: "scale(1)",
          },
        },
        rainbowBackground: {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        fadePop: {
          "0%": { opacity: "0", transform: "translate(-50%, -50%) scale(0.6)" },
          "30%": {
            opacity: "1",
            transform: "translate(-50%, -50%) scale(1.05)",
          },
          "70%": { transform: "translate(-50%, -50%) scale(1)" },
          "100%": {
            opacity: "0",
            transform: "translate(-50%, -50%) scale(0.9)",
          },
        },
        fadePop2: {
          "0%": { opacity: "0", transform: "translate(-50%, -50%) scale(0.6)" },
          "5%, 95%": {
            opacity: "1",
            transform: "translate(-50%, -50%) scale(1.05)",
          },
          "100%": {
            opacity: "0",
            transform: "translate(-50%, -50%) scale(0.9)",
          },
        },
      },
      animation: {
        rainbow: "rainbow 7s infinite",
        "bright-rainbow": "brightRainbow 7s linear infinite",
        "copper-glow": "copperGlow 3s ease-in-out infinite",
        "silver-glow": "silverGlow 3s ease-in-out infinite",
        "gold-glow": "goldGlow 3s ease-in-out infinite",
        neon: "neonPulseGreen 3s ease-in-out infinite",
        water: "waterFlicker 6.2s ease-in-out infinite",
        lava: "lavaFlow 6s ease-in-out infinite",
        "rainbow-bg": "rainbowBackground 10s ease infinite",
        fadePop: "fadePop 5s ease-out forwards",
        fadePop2: "fadePop2 10s ease-out forwards",
      },
    },
  },
  plugins: [],
  darkMode: "class",
};
