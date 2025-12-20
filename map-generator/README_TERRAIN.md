# Terrain & Map Mechanics

This document details how map input images are translated into game terrain, and how that terrain affects gameplay mechanics like combat and movement.

## 1. Map Generation (Input)

The map generator (`./map_generator.go`) reads a PNG image and converts pixels into terrain based primarily on the **Blue** channel.

### Pixel Mapping

**Note:** The map generator normalizes dimensions to multiples of 4. Any pixels beyond `Width - (Width % 4)` or `Height - (Height % 4)` are cropped.

| Input Condition    | Terrain Type    | Magnitude          | Notes                            |
| :----------------- | :-------------- | :----------------- | :------------------------------- |
| **Alpha < 20**     | Water           | Distance to Land\* | Transparent pixels become water. |
| **Blue = 106**     | Water           | Distance to Land\* | Specific key color for water.    |
| **Blue < 140**     | Land (Plains)   | 0                  | Clamped to minimum magnitude.    |
| **Blue 140 - 158** | Land (Plains)   | 0 - 9              | `(Blue - 140) / 2`               |
| **Blue 159 - 178** | Land (Highland) | 10 - 19            | `(Blue - 140) / 2`               |
| **Blue 179 - 200** | Land (Mountain) | 20 - 30            | `(Blue - 140) / 2`               |
| **Blue > 200**     | Land (Mountain) | 30                 | Clamped to maximum magnitude.    |

_\*For Water tiles, "Magnitude" is calculated during generation as the distance to the nearest land._

### Thumbnail Generation

The generator creates a `thumbnail.webp` using a specific color palette distinct from the in-game themes:

- **Water:** Transparent (Alpha 0).
- **Shoreline (Land):** `rgb(204, 203, 158)`
- **Plains:** Greenish `rgb(190, 220, 138)` - `rgb(190, 202, 138)`
- **Highlands:** Tan/Beige `rgb(220, 203, 158)` - `rgb(238, 221, 176)`
- **Mountains:** Grayscale `rgb(240, 240, 240)` - `rgb(245, 245, 245)`

---

## 2. Gameplay Mechanics (Output)

In-game, terrain affects **Pathfinding** (where units go) and **Combat Resolution** (how fast they conquer and how many die).

### Pathfinding Priority

_Defined in `../src/core/execution/AttackExecution.ts`_

When an attack expands, it prioritizes tiles with lower "resistance".

- **Plains:** Priority Cost 1
- **Highland:** Priority Cost 1.5
- **Mountain:** Priority Cost 2

Attacks naturally flow around mountains through plains unless forced otherwise.

### Combat Statistics (`attackLogic`)

_Defined in `../src/core/configuration/DefaultConfig.ts`_

Each terrain type has base statistics that determine the cost of conquering a tile.

| Terrain Type | Base Magnitude (`mag`) | Base Speed Cost (`speed`) | Gameplay Impact                           |
| :----------- | :--------------------- | :------------------------ | :---------------------------------------- |
| **Plains**   | **80**                 | **16.5**                  | Lowest casualties, fastest expansion.     |
| **Highland** | **100**                | **20.0**                  | +25% casualties, ~21% slower than Plains. |
| **Mountain** | **120**                | **25.0**                  | +50% casualties, ~51% slower than Plains. |

- **`mag` (Magnitude):** Determines attacker troop loss.
  - _PvE Loss:_ `mag / 5` (e.g., 16 troops per Plains tile).
- **`speed`:** Determines how much of the attack's "movement budget" is consumed.

### Modifiers & Scaling

The values listed above are base statistics. In actual gameplay, these are modified by factors such as structures (Defense Posts), environmental effects (Nuclear Fallout), and combat context (PvP scaling based on troop ratios).

---

## 3. Visual Themes (In-Game)

The game renders terrain using themes defined in `../src/core/configuration/PastelTheme.ts` (Light) and `../src/core/configuration/PastelThemeDark.ts` (Dark). The color of a tile is determined dynamically based on its **Terrain Type** and **Magnitude**.

### Light Theme (`PastelTheme.ts`)

| Terrain Type      | Magnitude | Base Color Logic                            | Visual Description                                                   |
| :---------------- | :-------- | :------------------------------------------ | :------------------------------------------------------------------- |
| **Shore (Land)**  | N/A       | Fixed: `rgb(204, 203, 158)`                 | Sandy beige. Overrides other land types if adjacent to water.        |
| **Plains**        | 0 - 9     | `rgb(190, 220, 138)` - `rgb(190, 202, 138)` | Light green. Gets slightly darker/less green as magnitude increases. |
| **Highland**      | 10 - 19   | `rgb(220, 203, 158)` - `rgb(238, 221, 176)` | Tan/Beige. Gets lighter as magnitude increases.                      |
| **Mountain**      | 20 - 30   | `rgb(240, 240, 240)` - `rgb(245, 245, 245)` | Grayscale (White/Grey). Represents snow caps or rocky peaks.         |
| **Water (Shore)** | 0         | Fixed: `rgb(100, 143, 255)`                 | Light blue near land.                                                |
| **Water (Deep)**  | 1 - 10+   | `rgb(70, 132, 180)` - `rgb(61, 123, 171)`   | Darker blue, adjusted slightly by distance to land.                  |

### Dark Theme (`PastelThemeDark.ts`)

| Terrain Type      | Magnitude | Base Color Logic                            | Visual Description    |
| :---------------- | :-------- | :------------------------------------------ | :-------------------- |
| **Shore (Land)**  | N/A       | Fixed: `rgb(134, 133, 88)`                  | Dark olive.           |
| **Plains**        | 0 - 9     | `rgb(140, 170, 88)` - `rgb(140, 152, 88)`   | Muted green.          |
| **Highland**      | 10 - 19   | `rgb(170, 153, 108)` - `rgb(188, 171, 126)` | Dark earth tone.      |
| **Mountain**      | 20 - 30   | `rgb(190, 190, 190)` - `rgb(195, 195, 195)` | Dark gray.            |
| **Water (Shore)** | 0         | Fixed: `rgb(50, 50, 50)`                    | Dark gray/black.      |
| **Water (Deep)**  | 1 - 10+   | `rgb(22, 19, 38)` - `rgb(14, 11, 30)`       | Very dark blue/black. |
