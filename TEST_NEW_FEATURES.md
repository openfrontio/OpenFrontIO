# Testing New Control Features

## How to Test

### 1. Test Alt + Scroll Wheel for Attack Ratio

1. Start the game (run `npm run dev`)
2. Join a game
3. Look at your attack ratio slider in the control panel
4. Hold the **Alt** key
5. **Scroll the mouse wheel up** - the attack ratio should increase
6. **Scroll the mouse wheel down** - the attack ratio should decrease
7. Release Alt
8. Verify that normal scrolling (without Alt) still zooms the map

**Expected Result:** Attack ratio changes by 10% with each scroll tick when Alt is held

### 2. Test Ctrl + Number Keys for Structure Filtering

1. Start the game and join a match
2. Build several different structure types (cities, factories, ports, etc.)
3. Hold the **Ctrl** key
4. Press **1** - only cities should be highlighted/visible (other structures dimmed)
5. While still holding Ctrl, press **2** - only factories should now be highlighted
6. Try other numbers (3-0) to filter by different structure types
7. **Release Ctrl** - all structures should return to normal visibility
8. Try pressing numbers **without Ctrl** - they should still build structures as normal

**Expected Result:**

- Holding Ctrl + pressing a number filters structures to show only that type
- Releasing Ctrl restores all structures to normal visibility
- Number keys without Ctrl still trigger normal build shortcuts
- **Browser tabs should NOT switch** when pressing Ctrl+Number (the game prevents this)

### Structure Type Mappings

Key | Structure Type
--- | --------------
1   | City
2   | Factory
3   | Port
4   | Defense Post
5   | Missile Silo
6   | SAM Launcher
7   | Warship
8   | Atom Bomb
9   | Hydrogen Bomb
0   | MIRV

## Troubleshooting

If features don't work:

1. Make sure you've rebuilt the project: `npm run build-dev`
2. Hard refresh your browser (Ctrl+Shift+R)
3. Check browser console for any errors (F12)
4. Make sure you're actually in a game (not just in the lobby)

## Code Review Checklist

- [x] Alt + Scroll modifies attack ratio
- [x] Alt + Scroll doesn't interfere with normal zoom
- [x] Shift + Scroll still works for attack ratio (backward compatibility)
- [x] Ctrl + Number filters structures
- [x] Releasing Ctrl restores all structures
- [x] Number keys without Ctrl still build structures
- [x] Alt and Ctrl keys are tracked in activeKeys
- [x] No TypeScript compilation errors
