# New Control Features

This document describes the cool new control features added to OpenFrontIO.

## Features Implemented

### 1. Alt + Scroll Wheel = Attack Ratio Control

**Previous behavior:** Only Shift + Scroll wheel adjusted the attack ratio.

**New behavior:** Now **Alt + Scroll wheel** also adjusts the attack ratio, giving players an alternative way to control their attack percentage.

- **Scroll Up (Alt held)**: Increases attack ratio by 10%
- **Scroll Down (Alt held)**: Decreases attack ratio by 10%

This provides more flexibility for players who find Alt more convenient than Shift, or who want to use Alt for specific gameplay scenarios.

### 2. Ctrl + Number Keys = Structure Filtering

**New feature:** Hold Ctrl and press any number key to show only that specific structure type, similar to how hovering over structures works in the UI.

**Key Mappings:**

- `Ctrl + 1`: Show only **Cities**
- `Ctrl + 2`: Show only **Factories**
- `Ctrl + 3`: Show only **Ports**
- `Ctrl + 4`: Show only **Defense Posts**
- `Ctrl + 5`: Show only **Missile Silos**
- `Ctrl + 6`: Show only **SAM Launchers**
- `Ctrl + 7`: Show only **Warships**
- `Ctrl + 8`: Show only **Atom Bombs**
- `Ctrl + 9`: Show only **Hydrogen Bombs**
- `Ctrl + 0`: Show only **MIRVs**

**Behavior:**

- While holding Ctrl and pressing a number, only that structure type is highlighted/visible (all others are dimmed)
- Release Ctrl to restore all structure visibility
- This helps players quickly focus on specific building types during strategic planning

## Technical Implementation

### Files Modified

- `src/client/InputHandler.ts`

### Changes Made

1. **Added `onAltScroll()` method**: Handles Alt + Scroll wheel events to adjust attack ratio
2. **Modified `onScroll()` method**: Updated condition to exclude Alt key from normal zooming (now checks `!event.shiftKey && !event.altKey`)

3. **Updated wheel event listener**: Added call to `onAltScroll()` in the wheel event handler

4. **Added Alt key tracking**: Added "AltLeft" and "AltRight" to the active keys tracking list

5. **Added browser tab prevention**: In the `keydown` event listener, added check at the beginning to prevent default browser behavior for Ctrl+Digit combinations (prevents browser tab switching)

6. **Added Ctrl + Number key handler**: In the `keyup` event listener, added logic to:

   - Detect Ctrl + Digit combinations
   - Map digits to corresponding structure types
   - Emit `ToggleStructureEvent` with the selected structure type

7. **Added Ctrl release handler**: When Ctrl key is released, emit `ToggleStructureEvent(null)` to restore all structure visibility

## Usage Examples

### Attack Ratio Control

```
While in game:
1. Hold Alt key
2. Scroll wheel up/down to adjust attack ratio
3. Release Alt to stop adjusting
```

### Structure Filtering

```
While in game:
1. Hold Ctrl key
2. Press a number key (e.g., "1" for cities)
3. Only that structure type is highlighted
4. Press different numbers while holding Ctrl to switch focus
5. Release Ctrl to show all structures normally
```

## Benefits

- **Alt + Scroll for Attack Ratio**: Provides an ergonomic alternative to Shift + Scroll
- **Ctrl + Number for Structure Filtering**:
  - Quickly assess strategic positions of specific building types
  - Focus on one building type without visual clutter
  - Fast switching between different structure types
  - Matches intuitive number key bindings players already know
  - **Prevents browser tab switching**: The game intercepts Ctrl+Number to prevent the browser from switching tabs, ensuring the game remains in focus

## Compatibility

- Works on all platforms (Windows, Mac, Linux)
- Mac users: Use the Control key as the modifier (Command key is not supported)
- No conflicts with existing keybindings
- Seamlessly integrates with the existing structure visibility system
