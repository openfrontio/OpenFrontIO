# Inventory Design

## Goal

Give players one dedicated place to view and equip every cosmetic they can use. The main navigation gains an Inventory entry, while the Store remains focused on purchasing items.

## User Experience

- Add an **Inventory** entry beside **Store** in the desktop navigation and an equivalent entry in the mobile navigation.
- Opening Inventory shows four category tabs: **Skins**, **Flags**, **Crowns**, and **Effects**.
- Each category shows only items the player owns, except that the Flags tab also shows every standard country flag.
- Skins includes both territory patterns and image skins because they occupy the same selection slot.
- Clicking a tile equips it immediately and visually marks it as selected.
- Each equip slot provides a Default or None tile that clears the current selection. The default country flag remains available in the Flags tab.
- Search filters items within the active category.
- Inventory includes a path to the Store for players who want more items.

The existing Cosmetics and Flag controls are removed from the play/lobby page. Inventory becomes the only interface for changing the cosmetic loadout.

## Architecture

Evolve the existing owned-cosmetics modal into the Inventory surface rather than creating a second ownership and selection implementation. Register it as the routed Inventory page and connect both navigation bars to that route.

Reuse the existing components and ownership model:

- `resolveCosmetics` remains the source of display-ready catalog items and ownership relationships.
- `CosmeticButton` remains the shared tile and selected-state presentation.
- `EffectsGrid` remains responsible for effect-type and nuke-type grouping in selection mode.
- `UserSettings` remains the source of the local equipped loadout.
- The country-flag list and flag persistence behavior move from the separate flag picker into the Inventory Flags tab.

The old Cosmetics and Flag modal routes, lobby controls, and event listeners are removed once their behavior is represented in Inventory. No server API, catalog schema, ownership schema, or stored-settings migration is required.

## Data Flow

1. Inventory loads the cosmetics catalog and the current `UserMeResponse`.
2. Catalog cosmetics are resolved against the player's flares and filtered to `relationship === "owned"`.
3. Country flags are appended to the Flags category as always-available selections.
4. The active values in `UserSettings` determine which tiles are highlighted.
5. Selecting a tile writes the corresponding setting and re-renders the affected category.
6. Default or None selections clear the appropriate stored setting.

Selection mappings remain compatible with existing game startup behavior:

- Patterns and image skins share the selected-pattern setting.
- Cosmetic and country flags use the flag setting.
- Crowns use the selected-crown setting.
- Effects use their existing effect slot, including separate nuke explosion slots where applicable.

## Purchase Behavior

The Store continues to display purchasable, unowned cosmetics. Completing a purchase makes the item available in Inventory after ownership data refreshes or the existing reload completes.

Purchases do not equip cosmetics automatically. Any existing checkout-return path that automatically selects a purchased pattern or flag is removed so Inventory is the single place where players change their loadout.

## Loading and Failure States

- While ownership data is unavailable, Inventory preserves the current loadout and does not write settings.
- If catalog or ownership loading fails, Inventory shows a non-destructive empty/error state rather than treating items as unowned or clearing selections.
- Guests can select defaults and country flags. Account-owned cosmetics appear after login.
- Empty owned categories show a localized empty state and retain the Store link.

## Localization and Accessibility

- Add localized strings for the Inventory navigation label, title, category empty states, and any loading/error copy introduced by the UI.
- Reuse existing translated cosmetic names and category labels where their meaning is unchanged.
- Category controls expose selected state, cosmetic tiles remain keyboard-operable buttons, and selected tiles continue to use the existing selected presentation.

## Verification

- Unit-test owned-item filtering and the inclusion of Default/None entries.
- Verify country flags remain available without ownership flares and that cosmetic flags remain ownership-gated.
- Verify selection and clearing for patterns/skins, flags, crowns, and each effect slot.
- Verify Store checkout completion no longer mutates the equipped loadout.
- Verify desktop and mobile Inventory navigation opens the routed Inventory page and receives active styling.
- Run focused tests, TypeScript checking, formatting/lint checks for changed files, and a production-equivalent client build.

## Non-Goals

- No multi-item loadouts, presets, favorites, sorting, rarity filters, or cosmetic counts.
- No changes to pricing, purchasing, ownership rules, catalog structure, or server APIs.
- No redesign of cosmetic tiles or effect previews.
- No in-game loadout changes after a match has started.
