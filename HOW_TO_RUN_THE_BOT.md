# 🤖 How to Run the OpenFront AI Bot

The AI bot has been **fully integrated** and is ready to use! Here's how to run it:

## 🚀 Quick Start (2 steps)

### 1. Start OpenFrontIO

```bash
npm start
```

### 2. Start a Singleplayer Game

- Go to "Single Player" in the main menu
- Choose any map and settings
- Start the game

**The bot is now available!** 🎉

## 🎮 Control the Bot

### Option A: Visual UI (Easiest)

1. **Look for the 🤖 icon** in the top-right corner of the game
2. **Click the icon** to open the bot control panel
3. **Click "Start Bot"** to activate AI assistance
4. **Watch the bot play!** It will:
   - Automatically select optimal spawn locations
   - Manage resources and troops
   - Make strategic decisions
   - Show real-time analysis

### Option B: Browser Console

1. **Open browser developer tools** (F12)
2. **Use these commands**:

```javascript
// Start the bot
openFrontBot.start();

// Check bot status
openFrontBot.status();

// Stop the bot
openFrontBot.stop();

// See detailed analysis
openFrontBot.analysis();

// Adjust difficulty
openFrontBot.updateConfig({ aggressiveness: 80 });
```

## 🎯 What the Bot Does

### ✅ Fully Working Features

- **Smart Spawning**: Analyzes the entire map to pick the best starting location
- **Resource Management**: Automatically adjusts troop/worker ratios
- **Strategic Analysis**: Comprehensive territory, threat, and opportunity assessment
- **Real-time Decisions**: Makes decisions every few seconds with explanations

### 🔄 Basic Implementation

- **Threat Detection**: Identifies incoming attacks and suggests responses
- **Expansion Planning**: Finds opportunities for territory growth
- **Diplomacy Analysis**: Evaluates alliance opportunities

### 🚧 Future Enhancements (Not Yet Implemented)

- Full attack execution
- Unit construction
- Naval operations
- Nuclear weapons
- Advanced diplomacy

## 🔧 Configuration

Customize bot behavior from the console:

```javascript
openFrontBot.updateConfig({
  difficulty: "Hard", // Easy, Medium, Hard, Expert
  aggressiveness: 75, // 0-100 (how often it attacks)
  expansionRate: 80, // 0-100 (how fast it expands)
  diplomaticStance: "Aggressive", // Peaceful, Neutral, Aggressive
});
```

## 🐛 Troubleshooting

### Bot Icon Not Showing?

- Make sure you're in a **singleplayer game** (bot doesn't work in multiplayer)
- Check browser console for "Initializing bot for singleplayer game" message

### Bot Not Making Decisions?

- Open console and run `openFrontBot.status()` to check if it's enabled
- Try `openFrontBot.forceTick()` to force a decision
- Check if the game is in spawn phase (bot waits for spawn to complete)

### Want More Debug Info?

```javascript
// See what the bot is thinking
openFrontBot.analysis();

// Check detailed status
openFrontBot.status();
```

## 🎭 Example Bot Session

```
1. Game starts → Bot icon (🤖) appears in top-right
2. Click icon → Control panel opens
3. Click "Start Bot" → Bot begins analysis
4. Spawn phase → Bot automatically selects best spawn location
5. Early game → Bot manages resources and looks for expansion
6. Mid game → Bot makes strategic decisions based on threats/opportunities
```

## 🏆 Advanced Usage

### Multiple Difficulty Levels

- **Easy**: Peaceful, slow, high confidence threshold
- **Medium**: Balanced approach (default)
- **Hard**: Aggressive, fast decisions, nuclear weapons enabled
- **Expert**: Very aggressive, risky plays, all features enabled

### Watch Bot Decisions

All bot actions are logged to the console with explanations:

```
PlayerBot: Spawning at (45, 32) with confidence 87%
Spawn reasons: Large land area (167 tiles), Isolated position, Good water access
```

---

**That's it!** The bot is ready to play OpenFrontIO. Start a singleplayer game and click the 🤖 icon to begin! 🎮
