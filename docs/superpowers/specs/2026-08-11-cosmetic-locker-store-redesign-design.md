# Cosmetic Locker and Store Redesign

## Goal

Turn Inventory into a game-style cosmetic locker that makes the active loadout
obvious and makes every selection feel immediate. Redesign Store around the same
visual system so browsing, previewing, purchasing, and equipping cosmetics feel
like one coherent product.

This design builds on the dedicated Inventory introduced by
`2026-08-11-inventory-design.md`. Its ownership rules, routes, persistence, and
purchase behavior remain in force unless this document explicitly changes the
presentation.

## Product Decisions

- Inventory uses a hybrid locker layout: an always-visible loadout bar, a large
  showcase for the active category, and a compact owned-item grid.
- The loadout bar has four entries: Skin, Flag, Crown, and one consolidated
  Effects entry.
- The showcase always describes what is equipped. Hovering or focusing another
  item does not replace the showcase with a temporary preview.
- Clicking an owned card equips it immediately.
- Clicking a pattern colour swatch equips that exact colour variant immediately;
  it does not require a second click on the card.
- Store receives the same visual redesign. It uses a browse-and-inspect layout:
  item grid plus a selected-item detail panel.
- Store selection is only a purchase preview. Neither selecting a Store card nor
  completing checkout equips the cosmetic.

## Inventory Experience

Inventory retains the Skins, Flags, Crowns, and Effects category tabs, search,
owned-only catalog filtering, country flags, Default/None choices, Store link,
and tab-aware route.

### Loadout Bar

The top of Inventory shows four compact loadout cards:

1. Skin
2. Flag
3. Crown
4. Effects

Each card shows a recognizable preview of its current selection and its category
label. Clicking a loadout card activates the corresponding category. The active
card has a clear blue navigation state; the equipped item shown within it uses
the same equipped language as the rest of Inventory.

Effects remains one top-level loadout card so the bar stays compact. Opening it
reveals the existing effect-type and nuke-type sub-tabs rather than expanding
every effect slot into the global loadout bar.

### Equipped Showcase

Below the loadout bar, the active category has a large showcase containing:

- the equipped item's visual preview;
- translated cosmetic name;
- rarity when applicable;
- selected colourway when applicable; and
- a prominent localized Equipped badge.

For Skins, Flags, and Crowns, the showcase represents the category's single
equip slot. For Effects, the active effect-type sub-tab determines which slot is
shown. Within nuke explosions, the active atom, hydro, or MIRV sub-tab determines
the exact slot shown. A cleared slot displays its localized Default or None
state.

The showcase is not a hover preview. It changes only when the equipped setting
changes or when the user moves to a category or effect slot with a different
equipped item.

### Owned-Item Grid

Owned cosmetics use compact locker cards with consistent dimensions and a large
preview area. Each card shows its translated name and rarity accent. Pattern
cards also show owned colour swatches.

The equipped item is unmistakable through all of these signals:

- a green check badge;
- a stronger selected border/glow;
- a localized Equipped label; and
- the active colour swatch when the cosmetic has variants.

Clicking a card equips its current variant immediately. Clicking a colour swatch
stops the parent-card click, equips that resolved variant directly, and updates
the card, showcase, and loadout bar in the same render cycle. Default and None
cards clear the corresponding slot immediately.

Country flags remain available to every user. Account cosmetics remain gated by
resolved ownership. Guests can use Default/None and country flags exactly as in
the existing Inventory.

## Store Experience

Store retains its existing categories, ownership and purchasability rules,
currency/payment methods, subscription handling, and checkout integration. Its
presentation changes to the shared cosmetic browsing system.

### Browse and Inspect

On desktop, Store places the cosmetic grid beside a sticky selected-item detail
panel. Clicking a card focuses it and gives it a blue outline. Focused is a Store
browsing state and must never reuse the green equipped treatment.

The detail panel contains:

- large visual preview;
- translated name;
- rarity and artist metadata when available;
- colour choices when the product has variants;
- price and payment-method controls; and
- the purchase action.

Choosing a colour updates the inspected and purchasable variant in the detail
panel. It does not write `UserSettings`. Checkout receives the exact variant
displayed by the panel. A successful purchase follows the current return/reload
flow and makes the item available in Inventory without equipping it.

Store continues to show product types such as packs and subscriptions that do
not map to an Inventory equip slot. The shared card and detail primitives accept
type-specific metadata and actions rather than assuming every item is
equipable.

### Initial and Changing Selection

When a Store category has purchasable items, its first visible item becomes the
initial inspected item. Search or category changes keep the current inspection
only when that item remains visible; otherwise the first visible item becomes
active. An empty result shows the existing localized empty state and no stale
detail panel.

## Shared Component Architecture

The current `CosmeticButton` combines preview rendering, variants, selection,
purchase controls, subscription details, and container styling. Replace that
overloaded surface with smaller shared components:

- `CosmeticPreview` renders patterns, skins, flags, crowns, effects, packs, and
  subscriptions without owning selection or purchase state.
- `CosmeticCard` renders the compact browse/equip card, rarity treatment, name,
  focus/equipped state, and optional colour swatches. It emits resolved-item and
  resolved-variant actions supplied by its parent.
- `CosmeticDetailPanel` renders the large preview, metadata, colour variants,
  status/action region, and Store purchase controls through explicit inputs.
- `InventoryLoadoutBar` maps equipped settings to the four category cards and
  emits category navigation.

`InventoryModal` owns equipped loadout state and immediate `UserSettings`
writes. `Store` owns its inspected item and purchase variant in memory. Neither
shared presentation component reads or writes `UserSettings` directly.

`EffectsGrid` retains effect-type and nuke-type ownership because those controls
encode real equip slots. It renders the new shared cards and reports its active
slot to Inventory so the showcase stays synchronized.

The win modal's post-game pattern promotion is also an existing
`CosmeticButton` consumer. It migrates to the compact `CosmeticCard` with a
narrow purchase-action adapter while retaining its current three-item promo
layout and direct purchase behavior. Redesigning the win modal itself is outside
this scope.

The old `CosmeticButton` is removed only after Store, Inventory, EffectsGrid,
the win-modal promotion, and their tests have migrated. Preview and metadata
code move into the new primitives rather than being copied.

## State and Data Flow

### Inventory

1. Inventory loads catalog and ownership data through the existing guarded flow.
2. `resolveCosmetics` remains the source of ownership and display-ready variants.
3. `UserSettings` is read into an explicit equipped-loadout view model.
4. The active category and effect sub-slot select which equipped entry the
   showcase renders.
5. Card, swatch, Default, and None actions write the exact relevant setting.
6. Existing settings-change events refresh loadout bar, showcase, grid badge,
   and active swatch together.

Only explicit user equip actions may write settings. Loading, rendering,
searching, tab changes, ownership refreshes, and error handling remain
read-only.

### Store

1. Store resolves its existing purchasable items.
2. Category/search state produces a visible item list.
3. Store owns one inspected `ResolvedCosmetic` from that list.
4. Card selection replaces the inspected item.
5. Detail-panel swatches replace it with the matching resolved colour variant.
6. Purchase receives the inspected resolved variant and existing payment method.
7. Purchase completion does not write equipped settings.

## Visual System

The redesign uses OpenFront's dark blue/black identity with game-locker clarity;
it does not copy Fortnite branding or assets.

- Blue communicates navigation and Store focus.
- Green communicates equipped state only.
- Rarity appears as a restrained strip, gradient, or border accent and never
  substitutes for focus or equipped state.
- Hover treatment is supplemental. Every action and state must work without
  hover.
- Cards have consistent preview, title, swatch, and status regions so mixed
  cosmetic types align cleanly.
- Loading placeholders reserve the same major regions as loaded content to avoid
  modal layout jumps.

## Responsive Behavior

Desktop Inventory stacks loadout bar, showcase, and owned grid. Desktop Store
uses grid plus sticky detail panel.

On narrow screens:

- the loadout bar scrolls horizontally without shrinking cards below a usable
  touch target;
- showcase and Store detail panel stack above their grids;
- cosmetic grids use two columns at phone widths and expand as space permits;
- all controls remain usable without hover; and
- sticky behavior must not obscure category tabs, search, or checkout controls.

## Accessibility and Localization

- Cards are keyboard-operable buttons or contain explicit keyboard-operable
  actions without invalid nested interactive elements.
- Focused Store cards expose the current selection state.
- Equipped Inventory cards and colour swatches expose `aria-pressed` or the
  appropriate selected-state semantics.
- Every swatch has a translated colourway label and a touch target large enough
  for reliable selection.
- Equipped, loadout, preview, empty, loading, retry, and other new visible text
  receives English localization keys and follows the existing translation
  system.
- Visible cosmetic names, rarities, effect types, and colourways reuse existing
  translations.

## Loading, Empty, and Failure States

- Catalog and ownership loading show stable skeletons for the loadout, showcase,
  and grid regions.
- Catalog or authenticated ownership failure preserves the complete stored
  loadout, performs no settings cleanup, and shows localized error and Retry
  controls.
- Retrying reruns the guarded catalog/ownership load without closing Inventory.
- An Inventory category with no owned catalog items retains its Default/None
  choice, localized empty copy, and Store path.
- Flags remain populated by standard country flags even when no cosmetic flags
  are owned.
- Store search/category results with no items show an empty state and clear the
  inspected detail content.

## Verification

Automated coverage must prove:

- shared cards distinguish focused, equipped, and ordinary states;
- a pattern card click equips its active variant;
- a pattern colour-swatch click immediately equips the exact variant without a
  parent-card click;
- loadout bar, showcase, selected card, and active swatch stay synchronized with
  `UserSettings` changes;
- Default/None clears patterns/skins, flags, crowns, and each effect slot;
- the consolidated Effects loadout navigates to Effects while the active effect
  sub-tab controls the showcase slot;
- Store card and swatch selection change only the inspected purchase variant;
- Store purchase uses that variant and never equips it;
- packs and subscriptions continue to render and purchase correctly;
- the win-modal pattern promotion retains its three-item direct-purchase flow;
- ownership/catalog failures remain non-destructive and Retry can recover;
- category search and empty states cannot leave a stale Store detail item;
- desktop and mobile DOM structure supports the specified layout and accessible
  interactions; and
- existing Inventory routing and Store checkout tests remain green.

Run focused component tests, the complete client/server test suite, TypeScript,
formatting and lint gates for changed files, and a production client build. A
browser smoke test must cover desktop and phone-width Inventory/Store layouts,
keyboard selection, immediate swatch equip, Store variant purchasing up to the
checkout boundary, and route/tab restoration.

## Non-Goals

- No presets or multiple saved loadouts.
- No favorites, sorting controls, rarity filters, or new search semantics.
- No new cosmetic types, prices, currencies, ownership rules, catalog schema, or
  server API.
- No automatic equipping after purchase.
- No 3D avatar or world preview; the redesign uses existing cosmetic preview
  capabilities.
- No cosmetic changes after a match has started.
