# Radial Menu System

The radial menu system provides a circular, context-sensitive menu that appears when players right-click on the map. This document explains how the radial menu system works and how to add new menu items.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Menu Element Structure](#menu-element-structure)
4. [Adding a New Menu Item](#adding-a-new-menu-item)
5. [Creating Submenus](#creating-submenus)
6. [Advanced Features](#advanced-features)
7. [Examples](#examples)

## Overview

### What is a Radial Menu?

A radial menu is a circular menu that appears at the cursor position when a player right-clicks on the map. It provides quick access to actions like:

- Building structures
- Attacking enemies
- Forming alliances
- Sending emojis
- And more

### Key Features

- **Context-Sensitive**: Menu items change based on what tile is clicked
- **Nested Submenus**: Supports multiple levels of nested menus
- **Dynamic Display**: Items can be shown/hidden based on game state
- **Tooltips**: Rich tooltips with cost, descriptions, and more
- **Cooldowns**: Visual cooldown indicators
- **Animations**: Smooth transitions between menu levels

## Architecture

### Components

**RadialMenu (`RadialMenu.ts`)**

- Core rendering and interaction logic
- Handles menu display, navigation, and animations
- Manages menu state and transitions

**RadialMenuElements (`RadialMenuElements.ts`)**

- Defines menu element structure
- Contains all menu item definitions
- Provides root menu element

**MainRadialMenu (`MainRadialMenu.ts`)**

- Integrates radial menu with game
- Handles context menu events
- Updates menu based on player actions

### Menu Hierarchy

```
Root Menu (rootMenuElement)
├── Info
├── Build (submenu)
│   ├── City
│   ├── Port
│   ├── Defense Post
│   └── ...
├── Attack (submenu)
│   ├── Atom Bomb
│   ├── Hydrogen Bomb
│   └── ...
├── Boat
├── Alliance
└── Delete
```

## Menu Element Structure

### MenuElement Interface

```typescript
export interface MenuElement {
  id: string; // Unique identifier
  name: string; // Display name
  displayed?: boolean | ((params: MenuElementParams) => boolean);
  color?: string; // Background color
  icon?: string; // Icon image path
  text?: string; // Text to display (alternative to icon)
  fontSize?: string; // Font size for text
  tooltipItems?: TooltipItem[]; // Tooltip content
  tooltipKeys?: TooltipKey[]; // Tooltip content (translated)
  cooldown?: (params: MenuElementParams) => number;
  disabled: (params: MenuElementParams) => boolean;
  action?: (params: MenuElementParams) => void; // Action for leaf items
  subMenu?: (params: MenuElementParams) => MenuElement[]; // Submenu items
}
```

### MenuElementParams

Provides context to menu items:

```typescript
export interface MenuElementParams {
  myPlayer: PlayerView; // Current player
  selected: PlayerView | null; // Selected player (if any)
  tile: TileRef; // Clicked tile
  playerActions: PlayerActions; // Available actions
  game: GameView; // Game view
  buildMenu: BuildMenu; // Build menu helper
  emojiTable: EmojiTable; // Emoji table helper
  playerActionHandler: PlayerActionHandler;
  playerPanel: PlayerPanel;
  chatIntegration: ChatIntegration;
  eventBus: EventBus;
  closeMenu: () => void; // Function to close menu
}
```

### TooltipItem

```typescript
export interface TooltipItem {
  text: string; // Tooltip text
  className: string; // CSS class for styling
}
```

### TooltipKey

```typescript
export interface TooltipKey {
  key: string; // Translation key
  className: string; // CSS class
  params?: Record<string, string | number>; // Translation params
}
```

## Adding a New Menu Item

### Step 1: Define Menu Element

Create a new `MenuElement` in `RadialMenuElements.ts`:

```typescript
export const myNewMenuItem: MenuElement = {
  id: "my_new_item",
  name: "My New Item",
  disabled: (params: MenuElementParams) => {
    // Return true if item should be disabled
    return params.game.inSpawnPhase();
  },
  color: "#ff0000", // Red color
  icon: myIconPath, // Path to icon SVG
  tooltipKeys: [
    {
      key: "radial_menu.my_new_item_title",
      className: "title",
    },
    {
      key: "radial_menu.my_new_item_description",
      className: "description",
    },
  ],
  action: (params: MenuElementParams) => {
    // Perform action
    params.playerActionHandler.handleMyNewAction(params.tile);
    params.closeMenu();
  },
};
```

### Step 2: Add to Root Menu

Add your item to `rootMenuElement.subMenu`:

```typescript
export const rootMenuElement: MenuElement = {
  id: "root",
  name: "root",
  disabled: () => false,
  subMenu: (params: MenuElementParams) => {
    const menuItems: (MenuElement | null)[] = [
      infoMenuElement,
      myNewMenuItem, // Add your item here
      buildMenuElement,
      // ... other items
    ];

    return menuItems.filter((item): item is MenuElement => item !== null);
  },
};
```

### Step 3: Add Translations

Add to `resources/lang/en.json`:

```json
{
  "radial_menu": {
    "my_new_item_title": "My New Item",
    "my_new_item_description": "Description of what this item does"
  }
}
```

### Step 4: Implement Action Handler

Add handler method to `PlayerActionHandler`:

```typescript
handleMyNewAction(tile: TileRef) {
  // Create intent
  const intent: Intent = {
    type: "my_new_action",
    clientID: this.clientID,
    tile: tile,
  };

  // Send turn
  this.sendTurn([intent]);
}
```

### Step 5: Create Execution

Create execution class (see [Adding New Features](./06-adding-features.md#adding-a-new-execution)):

```typescript
export class MyNewActionExecution implements Execution {
  // Implementation
}
```

## Creating Submenus

### Simple Submenu

Create a menu item that opens a submenu:

```typescript
export const mySubmenuItem: MenuElement = {
  id: "my_submenu",
  name: "My Submenu",
  disabled: (params: MenuElementParams) => false,
  color: "#00ff00",
  icon: submenuIcon,
  subMenu: (params: MenuElementParams) => {
    return [
      {
        id: "submenu_item_1",
        name: "Submenu Item 1",
        disabled: () => false,
        color: "#0000ff",
        icon: item1Icon,
        action: (params) => {
          // Action for item 1
          params.closeMenu();
        },
      },
      {
        id: "submenu_item_2",
        name: "Submenu Item 2",
        disabled: () => false,
        color: "#ff00ff",
        icon: item2Icon,
        action: (params) => {
          // Action for item 2
          params.closeMenu();
        },
      },
    ];
  },
};
```

### Dynamic Submenu

Submenu items can be generated dynamically:

```typescript
export const dynamicSubmenuItem: MenuElement = {
  id: "dynamic_submenu",
  name: "Dynamic Submenu",
  disabled: (params: MenuElementParams) => false,
  color: "#ffff00",
  icon: dynamicIcon,
  subMenu: (params: MenuElementParams) => {
    // Generate items based on game state
    const items: MenuElement[] = [];

    // Add items for each player
    params.game.players().forEach((player) => {
      items.push({
        id: `player_${player.id()}`,
        name: player.name(),
        disabled: () => false,
        color: player.color(),
        action: (params) => {
          // Action for this player
          params.closeMenu();
        },
      });
    });

    return items;
  },
};
```

## Advanced Features

### Conditional Display

Show/hide items based on conditions:

```typescript
export const conditionalItem: MenuElement = {
  id: "conditional",
  name: "Conditional",
  displayed: (params: MenuElementParams) => {
    // Only show if player owns tile
    const owner = params.game.owner(params.tile);
    return owner.isPlayer() && owner.id() === params.myPlayer.id();
  },
  disabled: () => false,
  // ... rest of config
};
```

### Cooldowns

Display cooldown timer:

```typescript
export const cooldownItem: MenuElement = {
  id: "cooldown",
  name: "Cooldown Item",
  cooldown: (params: MenuElementParams) => {
    // Return remaining cooldown in ticks
    return params.myPlayer.someCooldown();
  },
  disabled: (params: MenuElementParams) => {
    return params.myPlayer.someCooldown() > 0;
  },
  // ... rest of config
};
```

### Rich Tooltips

Add detailed tooltips:

```typescript
export const richTooltipItem: MenuElement = {
  id: "rich_tooltip",
  name: "Rich Tooltip",
  tooltipItems: [
    { text: "Title", className: "title" },
    { text: "Description text", className: "description" },
    { text: "1000 Gold", className: "cost" },
    { text: "5x", className: "count" },
  ],
  // ... rest of config
};
```

### Text Instead of Icon

Use text instead of icon:

```typescript
export const textItem: MenuElement = {
  id: "text_item",
  name: "Text Item",
  text: "ABC", // Text to display
  fontSize: "20px", // Font size
  color: "#ff0000",
  // ... rest of config
};
```

### Center Button

Customize center button behavior:

```typescript
export const centerButtonElement: CenterButtonElement = {
  disabled: (params: MenuElementParams): boolean => {
    // Return true if center button should be disabled
    return params.game.inSpawnPhase();
  },
  action: (params: MenuElementParams) => {
    // Action when center button clicked
    params.playerActionHandler.handleCenterAction(params.tile);
    params.closeMenu();
  },
};
```

## Examples

### Example 1: Simple Action Item

```typescript
export const simpleActionItem: MenuElement = {
  id: "simple_action",
  name: "Simple Action",
  disabled: (params: MenuElementParams) => {
    return params.game.inSpawnPhase();
  },
  color: "#00ff00",
  icon: actionIcon,
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleSimpleAction(params.tile);
    params.closeMenu();
  },
};
```

### Example 2: Build Menu Item

```typescript
export const buildMenuItem: MenuElement = {
  id: "build",
  name: "build",
  disabled: (params: MenuElementParams) => params.game.inSpawnPhase(),
  icon: buildIcon,
  color: COLORS.build,
  subMenu: (params: MenuElementParams) => {
    // Generate build items dynamically
    return params.playerActions.buildableUnits.map((unit) => ({
      id: `build_${unit.type}`,
      name: unit.type.toString(),
      disabled: () => unit.canBuild === false,
      color: unit.canBuild ? COLORS.building : undefined,
      icon: getUnitIcon(unit.type),
      tooltipItems: [
        { text: getUnitName(unit.type), className: "title" },
        { text: `${unit.cost} Gold`, className: "cost" },
      ],
      action: (params: MenuElementParams) => {
        if (unit.canBuild) {
          params.buildMenu.sendBuildOrUpgrade(unit, params.tile);
        }
        params.closeMenu();
      },
    }));
  },
};
```

### Example 3: Conditional Submenu

```typescript
export const conditionalSubmenuItem: MenuElement = {
  id: "conditional_submenu",
  name: "Conditional Submenu",
  displayed: (params: MenuElementParams) => {
    // Only show if player has selected another player
    return params.selected !== null;
  },
  disabled: () => false,
  color: "#ff00ff",
  icon: conditionalIcon,
  subMenu: (params: MenuElementParams) => {
    if (!params.selected) return [];

    const items: MenuElement[] = [];

    // Add different items based on relationship
    if (params.myPlayer.isAlliedWith(params.selected)) {
      items.push({
        id: "break_alliance",
        name: "Break Alliance",
        disabled: () => false,
        color: COLORS.breakAlly,
        icon: traitorIcon,
        action: (params) => {
          params.playerActionHandler.handleBreakAlliance(
            params.myPlayer,
            params.selected!,
          );
          params.closeMenu();
        },
      });
    } else {
      items.push({
        id: "request_alliance",
        name: "Request Alliance",
        disabled: (params) =>
          !params.playerActions.interaction?.canSendAllianceRequest,
        color: COLORS.ally,
        icon: allianceIcon,
        action: (params) => {
          params.playerActionHandler.handleAllianceRequest(
            params.myPlayer,
            params.selected!,
          );
          params.closeMenu();
        },
      });
    }

    return items;
  },
};
```

## Menu Configuration

### RadialMenuConfig

Customize menu appearance:

```typescript
const menuConfig: RadialMenuConfig = {
  menuSize: 190, // Base menu size
  submenuScale: 1.5, // Submenu scale factor
  centerButtonSize: 30, // Center button size
  iconSize: 32, // Icon size
  centerIconSize: 48, // Center icon size
  disabledColor: "#808080", // Disabled item color
  menuTransitionDuration: 300, // Animation duration
  mainMenuInnerRadius: 40, // Inner radius
  centerButtonIcon: swordIcon, // Center button icon
  maxNestedLevels: 3, // Max nesting depth
  innerRadiusIncrement: 20, // Radius increment per level
  tooltipStyle: `                   // Custom tooltip CSS
    .radial-tooltip .cost {
      color: #ffd700;
    }
  `,
};
```

## Best Practices

### 1. Use Meaningful IDs

```typescript
// BAD
id: "item1";

// GOOD
id: "build_city";
```

### 2. Provide Tooltips

Always include tooltips for clarity:

```typescript
tooltipKeys: [
  { key: "radial_menu.item_title", className: "title" },
  { key: "radial_menu.item_description", className: "description" },
];
```

### 3. Handle Edge Cases

Check for edge cases in disabled functions:

```typescript
disabled: (params: MenuElementParams) => {
  if (params.game.inSpawnPhase()) return true;
  if (!params.selected) return true;
  if (!params.playerActions.canAttack) return true;
  return false;
};
```

### 4. Close Menu After Actions

Always close menu after performing actions:

```typescript
action: (params: MenuElementParams) => {
  // Perform action
  params.playerActionHandler.handleAction();
  params.closeMenu(); // Important!
};
```

### 5. Use Appropriate Colors

Use consistent colors from `COLORS` object:

```typescript
import { COLORS } from "./RadialMenuElements";

color: COLORS.build,  // Instead of hardcoded "#ebe250"
```

### 6. Test Menu Items

Test menu items in different game states:

- Spawn phase
- Game phase
- Different tile types
- Different player relationships

## Troubleshooting

### Menu Not Appearing

- Check if `ContextMenuEvent` is being triggered
- Verify `rootMenuElement.subMenu` returns items
- Check `displayed` function returns true

### Item Always Disabled

- Check `disabled` function logic
- Verify `MenuElementParams` has required data
- Check game state conditions

### Submenu Not Opening

- Verify `subMenu` function returns array
- Check `subMenu` function doesn't throw errors
- Ensure items have valid IDs

### Tooltip Not Showing

- Verify `tooltipItems` or `tooltipKeys` are set
- Check translation keys exist
- Verify CSS classes are defined

## Next Steps

- Read [Adding New Features](./06-adding-features.md) for execution implementation
- Check [Core Game Systems](./03-core-systems.md) for game mechanics
- Review [Development Guide](./07-development.md) for testing tips
