# Cosmetic Locker and Store Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Store-style Inventory grid with a game locker that clearly shows the equipped loadout, while redesigning Store around the same shared card, preview, and detail system without changing ownership or purchase rules.

**Architecture:** Extract the current cosmetic preview and metadata behavior into stateless presentation primitives, then make Inventory and Store own their distinct state machines. Inventory maps `UserSettings` to equipped cards and writes only on explicit equip actions; Store owns an inspected purchase variant and never writes equipped settings. `EffectsGrid` remains the owner of effect/nuke sub-slots but delegates visual rendering to the shared primitives.

**Tech Stack:** TypeScript, Lit custom elements in light DOM, Tailwind utility classes, Vitest/jsdom, existing `ResolvedCosmetic`, `UserSettings`, `PurchaseButton`, and modal routing.

## Global Constraints

- Inventory keeps exactly four top-level categories: Skins, Flags, Crowns, and Effects.
- The global loadout bar keeps one consolidated Effects entry; individual effect and nuke slots remain inside Effects.
- The Inventory showcase always reflects an equipped setting, never a hover-only preview.
- Inventory card and colour-swatch activation equip immediately and stay in the modal.
- Only explicit Inventory equip/clear actions may write `UserSettings`; loading, searching, rendering, tab changes, retry, and ownership refresh are read-only.
- Store focus and colour selection are purchase-preview state only. Store selection and successful checkout must not write `UserSettings` or auto-equip.
- Preserve the existing catalog, ownership, pricing, currency, checkout, affiliate, subscription, country-flag, and effect-slot rules.
- Do not add backend endpoints, schemas, dependencies, presets, favorites, sorting, filters, 3D previews, or new cosmetic types.
- Blue communicates navigation/Store focus; green communicates equipped state only; rarity styling cannot substitute for either state.
- Phone layouts must work without hover and use a two-column cosmetic grid, stacked showcase/detail panel, and horizontally scrollable loadout bar.
- New visible copy must be localized in `resources/lang/en.json`, remain alphabetically sorted, and pass the translation integrity tests.

## File Structure

### New shared presentation files

- `src/client/components/CosmeticPreview.ts` — render-only preview for every `ResolvedCosmetic` type.
- `src/client/components/CosmeticPresentation.ts` — translated display-name and metadata helpers shared by cards and detail panels.
- `src/client/components/CosmeticCard.ts` — controlled compact card with idle/focused/equipped state and controlled variants.
- `src/client/components/CosmeticDetailPanel.ts` — large preview/metadata/status surface with controlled variants and caller-supplied action content.
- `src/client/components/InventoryLoadoutBar.ts` — four-category equipped summary and category navigation.

### Existing owners to modify

- `src/client/InventoryModal.ts` — equipped-loadout projection, showcase, immediate equip, retry, and locker layout.
- `src/client/Store.ts` — inspected-item state, grid/detail layout, variant purchase selection, and special-product panels.
- `src/client/components/EffectsGrid.ts` — shared cards plus active effect-slot and Store-focus callbacks.
- `src/client/components/PurchaseButton.ts` — self-contained busy state, no dependency on `cosmetic-container` ancestry.
- `src/client/components/CustomCurrencyCard.ts` — new visual frame without the legacy container.
- `src/client/hud/layers/WinModal.ts` — compose the new card with its existing direct-purchase promotion.
- `resources/lang/en.json` — Equipped, loadout, retry, and accessible/status copy.

### Legacy files to remove after all consumers migrate

- `src/client/components/CosmeticButton.ts`
- `src/client/components/CosmeticContainer.ts`
- `src/client/components/CosmeticInfo.ts`
- `tests/client/CosmeticButton.test.ts`

---

### Task 1: Extract cosmetic preview and presentation helpers

**Files:**

- Create: `src/client/components/CosmeticPresentation.ts`
- Create: `src/client/components/CosmeticPreview.ts`
- Create: `tests/client/CosmeticPreview.test.ts`
- Modify: `src/client/components/CosmeticButton.ts`
- Test: `tests/client/CosmeticButton.test.ts`

**Interfaces:**

- Produces: `cosmeticDisplayName(resolved: ResolvedCosmetic): string`
- Produces: `cosmeticRarity(resolved: ResolvedCosmetic): string`
- Produces: `<cosmetic-preview .resolved=${resolved} size="card|detail">`
- Preserves: the legacy `CosmeticButton` public API until Task 9 removes it.

- [ ] **Step 1: Write failing preview/helper tests**

Create `tests/client/CosmeticPreview.test.ts` with real resolved fixtures for a pattern, skin, country flag, crown, effect, pack, subscription, and Default item. Assert translated display names and the preview marker rendered for each type:

```ts
it("renders the resolved pattern palette", async () => {
  const preview = document.createElement("cosmetic-preview") as CosmeticPreview;
  preview.resolved = patternVariant("stripes", "ocean");
  document.body.appendChild(preview);
  await preview.updateComplete;

  expect(
    preview.querySelector('[data-cosmetic-preview="pattern"] img'),
  ).toBeTruthy();
  expect(cosmeticDisplayName(preview.resolved)).toBeTruthy();
});

it("renders Default without requiring a catalog cosmetic", async () => {
  const preview = document.createElement("cosmetic-preview") as CosmeticPreview;
  preview.resolved = defaultPattern();
  document.body.appendChild(preview);
  await preview.updateComplete;

  expect(
    preview.querySelector('[data-cosmetic-preview="default"]'),
  ).toBeTruthy();
});
```

- [ ] **Step 2: Run the tests and verify the missing modules fail**

Run:

```bash
npx vitest run tests/client/CosmeticPreview.test.ts
```

Expected: FAIL because `CosmeticPreview.ts` and `CosmeticPresentation.ts` do not exist.

- [ ] **Step 3: Extract the display helpers and preview renderer**

Implement the controlled preview interface:

```ts
@customElement("cosmetic-preview")
export class CosmeticPreview extends LitElement {
  @property({ attribute: false }) resolved!: ResolvedCosmetic;
  @property({ type: String }) size: "card" | "detail" = "card";

  createRenderRoot() {
    return this;
  }

  render() {
    return html`<div
      data-cosmetic-preview=${this.resolved.cosmetic === null
        ? "default"
        : this.resolved.type}
      class=${this.size === "detail" ? "h-full w-full" : "aspect-square w-full"}
    >
      ${this.renderResolvedPreview()}
    </div>`;
  }
}
```

Move the existing `CosmeticButton.renderPreview()` branches into `renderResolvedPreview()` without changing `renderPatternPreview`, image fallback, or effect preview behavior. Move the existing `displayName` type switch into `cosmeticDisplayName()`, including `Pack.displayName`, subscription translations, and Default.

- [ ] **Step 4: Make the legacy button consume the extraction**

Replace `CosmeticButton.displayName` and `renderPreview()` with:

```ts
const active = this.activeResolved;
const displayName = cosmeticDisplayName(active);

return html`<cosmetic-preview
  .resolved=${active}
  size="card"
></cosmetic-preview>`;
```

Keep the rest of `CosmeticButton` unchanged so this commit is behavior-preserving.

- [ ] **Step 5: Verify preview and legacy behavior**

Run:

```bash
npx vitest run tests/client/CosmeticPreview.test.ts tests/client/CosmeticButton.test.ts
npx tsc --noEmit
```

Expected: both test files PASS and TypeScript exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/client/components/CosmeticPresentation.ts src/client/components/CosmeticPreview.ts src/client/components/CosmeticButton.ts tests/client/CosmeticPreview.test.ts tests/client/CosmeticButton.test.ts
git commit -m "refactor(cosmetics): extract shared previews"
```

### Task 2: Build the controlled cosmetic card

**Files:**

- Create: `src/client/components/CosmeticCard.ts`
- Create: `tests/client/CosmeticCard.test.ts`
- Consume: `src/client/components/CosmeticPreview.ts`
- Consume: `src/client/components/CosmeticPresentation.ts`

**Interfaces:**

- Produces: `export type CosmeticCardState = "idle" | "focused" | "equipped"`
- Produces: `resolved: ResolvedCosmetic`
- Produces: `variants: readonly ResolvedCosmetic[]`
- Produces: `activeVariantKey: string | null`
- Produces: `state: CosmeticCardState`
- Produces: `onActivate?: (resolved: ResolvedCosmetic) => void`
- Produces: `onVariantActivate?: (resolved: ResolvedCosmetic) => void`
- Produces: `showSwatches: boolean`

- [ ] **Step 1: Write failing state and interaction tests**

Cover controlled state, main activation, and direct swatch activation:

```ts
it("distinguishes focus from equipped state", async () => {
  card.resolved = blue;
  card.state = "equipped";
  document.body.appendChild(card);
  await card.updateComplete;

  expect(card.dataset.cosmeticState).toBe("equipped");
  expect(card.querySelector('[data-cosmetic-equipped="true"]')).toBeTruthy();
  expect(card.querySelector("button")?.getAttribute("aria-pressed")).toBe(
    "true",
  );
});

it("activates a swatch without activating the parent item", async () => {
  const onActivate = vi.fn();
  const onVariantActivate = vi.fn();
  card.resolved = red;
  card.variants = [red, blue];
  card.activeVariantKey = red.key;
  card.onActivate = onActivate;
  card.onVariantActivate = onVariantActivate;
  document.body.appendChild(card);
  await card.updateComplete;

  card
    .querySelector<HTMLButtonElement>(`[data-variant-key="${blue.key}"]`)!
    .click();

  expect(onVariantActivate).toHaveBeenCalledWith(blue);
  expect(onActivate).not.toHaveBeenCalled();
});
```

Also assert that the main button activates the controlled active variant and that no `<button>` contains another `<button>`.

- [ ] **Step 2: Run the card tests and verify RED**

```bash
npx vitest run tests/client/CosmeticCard.test.ts
```

Expected: FAIL because `<cosmetic-card>` is not registered.

- [ ] **Step 3: Implement the controlled card**

Use a non-interactive wrapper with sibling main/swatch buttons:

```ts
@customElement("cosmetic-card")
export class CosmeticCard extends LitElement {
  @property({ attribute: false }) resolved!: ResolvedCosmetic;
  @property({ attribute: false }) variants: readonly ResolvedCosmetic[] = [];
  @property({ type: String }) activeVariantKey: string | null = null;
  @property({ type: String }) state: CosmeticCardState = "idle";
  @property({ type: Boolean }) showSwatches = true;
  @property({ attribute: false }) onActivate?: (
    value: ResolvedCosmetic,
  ) => void;
  @property({ attribute: false }) onVariantActivate?: (
    value: ResolvedCosmetic,
  ) => void;

  private get activeResolved(): ResolvedCosmetic {
    return (
      this.variants.find((item) => item.key === this.activeVariantKey) ??
      this.resolved
    );
  }
}
```

Render `data-cosmetic-state`, a blue focus ring for `focused`, a green check/Equipped treatment for `equipped`, a rarity accent independent of state, a `<cosmetic-preview>`, translated name, and controlled swatches. Use `aria-pressed="true"` only for equipped cards; use `aria-current="true"` for Store focus.

- [ ] **Step 4: Verify interaction, accessibility, and formatting**

```bash
npx vitest run tests/client/CosmeticCard.test.ts tests/client/CosmeticPreview.test.ts
npx prettier --check src/client/components/CosmeticCard.ts tests/client/CosmeticCard.test.ts
npx tsc --noEmit
```

Expected: all tests PASS; Prettier and TypeScript exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/client/components/CosmeticCard.ts tests/client/CosmeticCard.test.ts
git commit -m "feat(cosmetics): add locker cards"
```

### Task 3: Build the detail panel and decouple purchase busy state

**Files:**

- Create: `src/client/components/CosmeticDetailPanel.ts`
- Create: `tests/client/CosmeticDetailPanel.test.ts`
- Create: `tests/client/PurchaseButton.test.ts`
- Modify: `src/client/components/PurchaseButton.ts`
- Consume: `src/client/components/CosmeticPreview.ts`
- Consume: `src/client/components/CosmeticPresentation.ts`

**Interfaces:**

- Produces: `context: "inventory" | "store"`
- Produces: `resolved: ResolvedCosmetic | null`
- Produces: `variants: readonly ResolvedCosmetic[]`
- Produces: `activeVariantKey: string | null`
- Produces: `statusText: string`
- Produces: `onVariantActivate?: (resolved: ResolvedCosmetic) => void`
- Produces: `actionContent: TemplateResult | typeof nothing`
- Preserves: all `PurchaseButton` price, confirmation, and insufficient-currency callbacks.

- [ ] **Step 1: Write failing detail-panel tests**

```ts
it("shows the inspected Store variant and delegates swatches", async () => {
  const onVariantActivate = vi.fn();
  panel.context = "store";
  panel.resolved = red;
  panel.variants = [red, blue];
  panel.activeVariantKey = red.key;
  panel.onVariantActivate = onVariantActivate;
  panel.actionContent = html`<button data-test-action>Buy</button>`;
  document.body.appendChild(panel);
  await panel.updateComplete;

  panel
    .querySelector<HTMLButtonElement>(`[data-detail-variant="${blue.key}"]`)!
    .click();
  expect(onVariantActivate).toHaveBeenCalledWith(blue);
  expect(panel.querySelector("[data-test-action]")).toBeTruthy();
});
```

Add an Inventory-context assertion for the Equipped status and a `resolved = null` assertion that removes stale detail content.

- [ ] **Step 2: Write a failing standalone purchase-busy test**

Create a deferred purchase promise, mount `<purchase-button>` without `cosmetic-container`, click its dollar button, and assert `aria-busy="true"`, a spinner, and duplicate-click suppression until the promise resolves.

- [ ] **Step 3: Run both test files and verify RED**

```bash
npx vitest run tests/client/CosmeticDetailPanel.test.ts tests/client/PurchaseButton.test.ts
```

Expected: detail module missing and standalone purchase button lacks rendered busy state.

- [ ] **Step 4: Implement the detail panel**

```ts
@customElement("cosmetic-detail-panel")
export class CosmeticDetailPanel extends LitElement {
  @property({ type: String }) context: "inventory" | "store" = "inventory";
  @property({ attribute: false }) resolved: ResolvedCosmetic | null = null;
  @property({ attribute: false }) variants: readonly ResolvedCosmetic[] = [];
  @property({ type: String }) activeVariantKey: string | null = null;
  @property({ type: String }) statusText = "";
  @property({ attribute: false }) onVariantActivate?: (
    value: ResolvedCosmetic,
  ) => void;
  @property({ attribute: false }) actionContent:
    | TemplateResult
    | typeof nothing = nothing;
}
```

Render large preview, display name, rarity, artist, active colourway, controlled swatches, status region, and `actionContent`. Mark the shell with `data-detail-context` and return `nothing` when `resolved` is null.

- [ ] **Step 5: Make PurchaseButton own its busy indicator**

Replace `closest("cosmetic-container")` overlay mutation with component state:

```ts
@state() private busy = false;

private executePurchase(handler?: () => Promise<PurchaseResult>) {
  if (!handler || this.busy) return;
  this.busy = true;
  void Promise.resolve(handler())
    .then((result) => {
      if (result) this.insufficient = result;
    })
    .finally(() => (this.busy = false));
}
```

Render `aria-busy`, disable every purchase button while busy, and render the existing spinner inside `.purchase-btn-wrap` so Store detail, CustomCurrencyCard, and the win modal all work without legacy ancestry.
Replace every `cosmetic-container:hover` selector in the injected purchase CSS
with equivalent hover classes scoped to `.purchase-btn-wrap`; Task 9 must be able
to delete `CosmeticContainer` without changing purchase feedback.

- [ ] **Step 6: Verify detail and purchase behavior**

```bash
npx vitest run tests/client/CosmeticDetailPanel.test.ts tests/client/PurchaseButton.test.ts
npx tsc --noEmit
```

Expected: both files PASS and TypeScript exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/client/components/CosmeticDetailPanel.ts src/client/components/PurchaseButton.ts tests/client/CosmeticDetailPanel.test.ts tests/client/PurchaseButton.test.ts
git commit -m "feat(cosmetics): add item detail panel"
```

### Task 4: Add the four-slot Inventory loadout bar

**Files:**

- Create: `src/client/components/InventoryLoadoutBar.ts`
- Create: `tests/client/InventoryLoadoutBar.test.ts`
- Modify: `resources/lang/en.json`

**Interfaces:**

- Produces: `export type InventoryCategory = "skins" | "flags" | "crowns" | "effects"`
- Produces: `InventoryLoadoutEntry { category: InventoryCategory; label: string; items: readonly ResolvedCosmetic[]; summary: string }`
- Produces: `entries: readonly InventoryLoadoutEntry[]`
- Produces: `activeCategory: InventoryCategory`
- Produces: `onCategorySelect?: (category: InventoryCategory) => void`

- [ ] **Step 1: Write failing loadout rendering/navigation tests**

```ts
it("renders exactly four category controls and reports navigation", async () => {
  const onCategorySelect = vi.fn();
  bar.entries = entriesForAllCategories();
  bar.activeCategory = "skins";
  bar.onCategorySelect = onCategorySelect;
  document.body.appendChild(bar);
  await bar.updateComplete;

  expect(bar.querySelectorAll("[data-loadout-category]")).toHaveLength(4);
  bar
    .querySelector<HTMLButtonElement>('[data-loadout-category="effects"]')!
    .click();
  expect(onCategorySelect).toHaveBeenCalledWith("effects");
});
```

Add a test with five equipped effect items; assert the Effects entry renders at most three preview layers plus `+2`, while still remaining one top-level category.

- [ ] **Step 2: Run the loadout tests and verify RED**

```bash
npx vitest run tests/client/InventoryLoadoutBar.test.ts
```

Expected: FAIL because the component is absent.

- [ ] **Step 3: Implement the controlled loadout bar**

```ts
export interface InventoryLoadoutEntry {
  category: InventoryCategory;
  label: string;
  items: readonly ResolvedCosmetic[];
  summary: string;
}
```

Render sibling category buttons inside `data-inventory-loadout`, use `aria-pressed` for the active category, render one preview for Skin/Flag/Crown, and overlap the first three Effects previews with a `+N` count. Use horizontal overflow and fixed minimum card width rather than shrinking touch targets.

- [ ] **Step 4: Add localized loadout/status strings in sorted order**

Add these exact English meanings under `inventory` using repository naming conventions:

```json
{
  "equipped": "Equipped",
  "loadout": "Your loadout",
  "retry": "Retry",
  "showing_effects": "{count} effects equipped"
}
```

Run Prettier after insertion so top-level and nested keys remain sorted.

- [ ] **Step 5: Verify component and translation integrity**

```bash
npx vitest run tests/client/InventoryLoadoutBar.test.ts tests/TranslationSystem.test.ts tests/EnJsonSorted.test.ts
npx prettier --check src/client/components/InventoryLoadoutBar.ts tests/client/InventoryLoadoutBar.test.ts resources/lang/en.json
```

Expected: all tests PASS and Prettier exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/client/components/InventoryLoadoutBar.ts tests/client/InventoryLoadoutBar.test.ts resources/lang/en.json
git commit -m "feat(inventory): add equipped loadout bar"
```

### Task 5: Migrate EffectsGrid to shared cards and expose its active slot

**Files:**

- Modify: `src/client/components/EffectsGrid.ts`
- Create: `tests/client/EffectsGrid.test.ts`
- Consume: `src/client/components/CosmeticCard.ts`

**Interfaces:**

- Produces: `EffectSlotSelection { effectType: EffectType; slot: string; resolved: ResolvedCosmetic | null }`
- Produces: `onActiveSlotChange?: (selection: EffectSlotSelection) => void`
- Produces: `onPurchaseFocus?: (resolved: ResolvedCosmetic) => void`
- Produces: `focusedKey: string | null`
- Consumes: `CosmeticCard.onActivate`, `CosmeticCard.state`

- [ ] **Step 1: Write failing effect-slot and mode tests**

Cover all of these behaviors in `tests/client/EffectsGrid.test.ts`:

```ts
it("reports the exact atom/hydro/MIRV slot when sub-tabs change", async () => {
  const onActiveSlotChange = vi.fn();
  grid.mode = "select";
  grid.tabbed = true;
  grid.cosmetics = effectCatalog;
  grid.userMeResponse = ownedUser;
  grid.onActiveSlotChange = onActiveSlotChange;
  document.body.appendChild(grid);
  await grid.updateComplete;

  clickEffectType(grid, "nukeExplosion");
  clickNukeType(grid, "hydro");

  expect(onActiveSlotChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ effectType: "nukeExplosion", slot: "hydro" }),
  );
});
```

Also assert select mode marks the stored effect `equipped`, Default clears the exact slot, purchase mode calls `onPurchaseFocus` without calling `purchaseCosmetic`, and `focusedKey` marks only the Store-focused effect.

- [ ] **Step 2: Run the EffectsGrid test and verify RED**

```bash
npx vitest run tests/client/EffectsGrid.test.ts
```

Expected: FAIL because callbacks and shared-card rendering are absent.

- [ ] **Step 3: Add explicit tab handlers and active-slot reporting**

```ts
export interface EffectSlotSelection {
  effectType: EffectType;
  slot: string;
  resolved: ResolvedCosmetic | null;
}

private activeSlot(): string {
  return this.activeType === "nukeExplosion"
    ? this.activeNukeType
    : this.activeType;
}
```

Replace direct template assignments with `selectEffectType(type)` and `selectNukeType(type)`. Each handler updates state and calls one `emitActiveSlot()` that resolves the stored effect for the active slot.

- [ ] **Step 4: Replace both mode renderers with CosmeticCard**

For selection mode:

```ts
return html`<cosmetic-card
  .resolved=${resolved}
  state=${isSelected ? "equipped" : "idle"}
  .onActivate=${() => this.select(slot, name)}
></cosmetic-card>`;
```

For purchase mode, set `state="focused"` only when `resolved.key === focusedKey` and call `onPurchaseFocus(resolved)`. Do not render purchase controls inside EffectsGrid.

- [ ] **Step 5: Verify all effect slots and TypeScript**

Before running the pre-Inventory-migration regression, update only the Effects
assertions in `InventoryModal.test.ts` to query `cosmetic-card` and invoke its
`onActivate` callback. Keep the legacy helper for Skins/Flags/Crowns until Task
6 migrates those grids; this is an intentional one-task compatibility bridge.

```bash
npx vitest run tests/client/EffectsGrid.test.ts tests/client/InventoryModal.test.ts
npx tsc --noEmit
```

Expected: all tests PASS and TypeScript exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/client/components/EffectsGrid.ts tests/client/EffectsGrid.test.ts tests/client/InventoryModal.test.ts
git commit -m "refactor(effects): expose locker slot state"
```

### Task 6: Turn Inventory into the hybrid locker

**Files:**

- Modify: `src/client/InventoryModal.ts`
- Modify: `tests/client/InventoryModal.test.ts`
- Modify: `resources/lang/en.json`
- Consume: `src/client/components/CosmeticCard.ts`
- Consume: `src/client/components/CosmeticDetailPanel.ts`
- Consume: `src/client/components/InventoryLoadoutBar.ts`
- Consume: `src/client/components/EffectsGrid.ts`

**Interfaces:**

- Consumes: `InventoryCategory`, `InventoryLoadoutEntry`, and `EffectSlotSelection` from Tasks 4–5.
- Produces internally: `activeEffectSlot: EffectSlotSelection | null`
- Produces internally: `equippedForCategory(category: InventoryCategory): ResolvedCosmetic | null`
- Produces internally: `loadoutEntries(): InventoryLoadoutEntry[]`
- Preserves: `open({tab})`, search, owned filtering, country flags, read-only load failure, and current route behavior.

- [ ] **Step 1: Expand the Inventory fixtures and write failing locker tests**

Add a real pattern with red/blue palettes to the catalog fixture. Add tests that assert:

```ts
it("keeps loadout, showcase, card, and swatch synchronized", async () => {
  new UserSettings().setSelectedPatternName("pattern:stripes:red");
  await showTab(modal, "skins");

  expect(modal.querySelector('[data-loadout-category="skins"]')).toBeTruthy();
  expect(
    modal.querySelector('[data-detail-context="inventory"]')?.textContent,
  ).toContain("Equipped");
  expect(card(modal, "pattern:stripes:red").state).toBe("equipped");

  activateVariant(modal, "pattern:stripes:blue");

  expect(localStorage.getItem(PATTERN_KEY)).toBe("pattern:stripes:blue");
  expect(card(modal, "pattern:stripes:blue").state).toBe("equipped");
  expect(showcase(modal).resolved?.key).toBe("pattern:stripes:blue");
});
```

Add tests for all four loadout buttons, Default/None clearing, cosmetic/country flags, crowns, each effect slot, the consolidated Effects count, and settings events fired outside Inventory.

- [ ] **Step 2: Write failing retry/skeleton/responsive structure tests**

Assert the loading DOM has `data-inventory-skeleton="loadout|showcase|grid"`; the error DOM contains a localized Retry button; retry calls the guarded loader without changing `PATTERN_KEY`, `FLAG_KEY`, `CROWN_KEY`, or `EFFECTS_KEY`; and the loadout/grid carry horizontal-scroll/two-column markers used by the responsive classes.

- [ ] **Step 3: Run Inventory tests and verify RED**

```bash
npx vitest run tests/client/InventoryModal.test.ts
```

Expected: FAIL because the locker, showcase, direct swatch equip, and retry controls are absent.

- [ ] **Step 4: Project equipped settings into resolved items**

Build one resolved list per refresh and derive the Skin slot through the existing
read-only compatibility getters rather than treating raw storage as canonical:

```ts
private resolvedItems(): ResolvedCosmetic[] {
  return resolveCosmetics(this.cosmetics, this.userMeResponse, null);
}

private equippedSkin(): ResolvedCosmetic | null {
  const items = this.resolvedItems();
  const skinName = this.userSettings.getSelectedSkinName();
  if (skinName !== null) {
    return items.find(
      (item) => item.type === "skin" && item.cosmetic?.name === skinName,
    ) ?? null;
  }
  const pattern = this.userSettings.getSelectedPatternName(this.cosmetics);
  if (pattern === null) {
    return items.find((item) => item.key === "pattern:default") ?? null;
  }
  return items.find(
    (item) =>
      item.type === "pattern" &&
      item.cosmetic?.name === pattern.name &&
      (item.colorPalette?.name ?? null) ===
        (pattern.colorPalette?.name ?? null),
  ) ?? null;
}
```

Normalize legacy country flag storage through `UserSettings.getFlag()`. Resolve crowns by cosmetic name and effects by effect slot/name. Represent Default/None with the same resolved default tiles rendered in the grid. Never call ownership-validating/mutating loadout helpers during this projection.

- [ ] **Step 5: Render the loadout, showcase, and shared-card grids**

Render in this order:

```ts
return html`
  <inventory-loadout-bar
    .entries=${this.loadoutEntries()}
    .activeCategory=${tab as InventoryCategory}
    .onCategorySelect=${(category: InventoryCategory) =>
      this.setActiveTab(category)}
  ></inventory-loadout-bar>
  <cosmetic-detail-panel
    context="inventory"
    .resolved=${this.equippedForCategory(tab as InventoryCategory)}
    .statusText=${translateText("inventory.equipped")}
  ></cosmetic-detail-panel>
  ${grid}
`;
```

Replace every Inventory `cosmetic-button` with controlled `cosmetic-card`. Pass the complete variant group, the equipped key, and immediate `onVariantActivate=${(variant) => this.selectCosmetic(variant)}`.
Replace the transitional test helpers from Task 5 with a single
`CosmeticCard`-typed helper and exercise every category through `onActivate` or
`onVariantActivate`.

- [ ] **Step 6: Synchronize every settings key and Effects showcase slot**

Listen to `PATTERN_KEY`, `FLAG_KEY`, `CROWN_KEY`, and `EFFECTS_KEY`. On each event, call only `updateFromSettings()`/`requestUpdate()`. Wire `EffectsGrid.onActiveSlotChange` to `activeEffectSlot`, and use that exact slot's resolved selection in the showcase.

- [ ] **Step 7: Add stable loading skeletons and a guarded Retry**

Retry calls `loadInventory()` and remains disabled while loading. Keep the existing explicit `loading | guest | loaded | error` ownership state, and do not clear settings on any failure path.

- [ ] **Step 8: Verify Inventory and navigation**

```bash
npx vitest run tests/client/InventoryModal.test.ts tests/client/InventoryNavigation.test.ts tests/client/EffectsGrid.test.ts
npx tsc --noEmit
npx prettier --check src/client/InventoryModal.ts tests/client/InventoryModal.test.ts resources/lang/en.json
```

Expected: all tests PASS; TypeScript and Prettier exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/client/InventoryModal.ts tests/client/InventoryModal.test.ts resources/lang/en.json
git commit -m "feat(inventory): build cosmetic locker"
```

### Task 7: Redesign Store cosmetics and effects around inspected state

**Files:**

- Modify: `src/client/Store.ts`
- Create: `tests/client/StoreModal.test.ts`
- Modify: `src/client/components/EffectsGrid.ts`
- Modify: `tests/client/EffectsGrid.test.ts`
- Consume: `src/client/components/CosmeticCard.ts`
- Consume: `src/client/components/CosmeticDetailPanel.ts`
- Consume: `src/client/components/PurchaseButton.ts`

**Interfaces:**

- Produces internally: `inspected: ResolvedCosmetic | null`
- Produces internally: `visibleGroups: readonly (readonly ResolvedCosmetic[])[]`
- Produces internally: `selectVisible(groups): void`
- Consumes: `EffectsGrid.onPurchaseFocus` and `focusedKey`.
- Preserves: `purchaseCosmetic(resolved, method)` as the only checkout entry point.

- [ ] **Step 1: Write failing Store selection/variant tests**

Mock `fetchCosmetics`, `resolveCosmetics`, and `purchaseCosmetic`, then assert:

```ts
it("inspects the first visible item and purchases the selected variant", async () => {
  await openStoreOnCosmetic("patterns");
  expect(detail(store).resolved?.key).toBe(red.key);

  focusCard(store, bluePatternGroupKey);
  activateDetailVariant(store, blue.key);
  clickHardPurchase(store);

  await vi.waitFor(() =>
    expect(purchaseCosmetic).toHaveBeenCalledWith(blue, "hard"),
  );
  expect(localStorage.getItem(PATTERN_KEY)).toBeNull();
});
```

Add tests that focused uses blue rather than equipped green, a category/catalog
change retains a still-visible inspected item, an invisible inspected item falls
back to the first visible group, and an empty category clears the detail panel.

- [ ] **Step 2: Write failing Store Effects tests**

Open the Effects tab, activate an effect and nuke subtype through `EffectsGrid`, and assert the Store detail panel receives the focused effect while no `UserSettings` effect key changes.

- [ ] **Step 3: Run Store/Effects tests and verify RED**

```bash
npx vitest run tests/client/StoreModal.test.ts tests/client/EffectsGrid.test.ts
```

Expected: FAIL because Store still renders inline purchase cards and owns no inspected state.

- [ ] **Step 4: Add controlled inspected-item helpers**

```ts
private inspected: ResolvedCosmetic | null = null;

private inspect(resolved: ResolvedCosmetic): void {
  this.inspected = resolved;
  this.requestUpdate();
}

private reconcileInspection(groups: readonly (readonly ResolvedCosmetic[])[]) {
  const visible = groups.flat();
  const current = visible.find((item) => item.key === this.inspected?.key);
  this.inspected = current ?? groups[0]?.[0] ?? null;
}
```

Call reconciliation after category, catalog, and affiliate changes, not from
`render()` in a way that causes an update loop.
Override `onTabEnter(key)` for Store top-level tabs and route cosmetics sub-tab
clicks through `setCosmeticsSubTab(tab)`; both handlers compute the next visible
groups and call `reconcileInspection()` before requesting an update.

- [ ] **Step 5: Render the desktop/mobile browse-detail shell**

Use one semantic layout marker and responsive classes:

```ts
return html`<div
  data-store-browser
  class="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]"
>
  <div
    data-store-grid
    class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4"
  >
    ${cards}
  </div>
  <aside class="order-first lg:order-none lg:sticky lg:top-0 lg:self-start">
    ${this.renderInspectedDetail()}
  </aside>
</div>`;
```

Cards set `state="focused"`, emit `inspect()`, and use controlled swatches. Detail swatches call `inspect(variant)`. Render `PurchaseButton` as `actionContent` with callbacks that close over exactly `this.inspected` and forward each payment method to `purchaseCosmetic`.

- [ ] **Step 6: Move Effects purchase focus into the Store detail panel**

Pass `focusedKey=${this.inspected?.key ?? null}` and `.onPurchaseFocus=${(item) => this.inspect(item)}`. Remove `purchaseCosmetic` from EffectsGrid purchase-mode rendering.

- [ ] **Step 7: Verify Store cosmetics/effects and checkout regression**

```bash
npx vitest run tests/client/StoreModal.test.ts tests/client/EffectsGrid.test.ts tests/client/CosmeticPurchaseCompletion.test.ts
npx tsc --noEmit
```

Expected: all tests PASS and TypeScript exits 0.

- [ ] **Step 8: Commit**

```bash
git add src/client/Store.ts src/client/components/EffectsGrid.ts tests/client/StoreModal.test.ts tests/client/EffectsGrid.test.ts
git commit -m "feat(store): add cosmetic detail browser"
```

### Task 8: Migrate Store packs, subscriptions, affiliate mode, and custom currency

**Files:**

- Modify: `src/client/Store.ts`
- Modify: `tests/client/StoreModal.test.ts`
- Modify: `src/client/components/CustomCurrencyCard.ts`
- Create: `tests/client/CustomCurrencyCard.test.ts`

**Interfaces:**

- Consumes: Store `inspect`, `reconcileInspection`, shared card/detail panel, and standalone `PurchaseButton` from Tasks 2–7.
- Preserves: subscription Switch/current-tier semantics, direct dollar checkout, hard/soft confirmation, affiliate filtering, and custom amount bounds `20..2000` at 20 plutonium per dollar.

- [ ] **Step 1: Write failing special-product Store tests**

Add tests that packs and subscriptions use the grid/detail shell, subscription detail shows Subscribed for the current tier and Switch for another tier, affiliate mode inspects only affiliate-visible products, and purchase callbacks receive the exact pack/subscription/affiliate resolved item.

```ts
it("does not leave an inspected non-affiliate item in affiliate mode", async () => {
  await openNormalStoreWithInspection(nonAffiliateItem);
  await store.open({ affiliateCode: "creator" });

  expect(detail(store).resolved?.key).toBe(affiliateItem.key);
  expect(
    store.querySelector(`[data-cosmetic-key="${nonAffiliateItem.key}"]`),
  ).toBeNull();
});
```

- [ ] **Step 2: Write failing custom-currency visual/checkout tests**

Assert the card no longer renders `cosmetic-container`, still clamps number and range input values to `20..2000`, and calls `createCustomCurrencyCheckout(amount)` through a standalone `PurchaseButton`.

- [ ] **Step 3: Run special-product tests and verify RED**

```bash
npx vitest run tests/client/StoreModal.test.ts tests/client/CustomCurrencyCard.test.ts
```

Expected: FAIL because special products still use legacy containers/cards.

- [ ] **Step 4: Route packs, subscriptions, and affiliate groups through the browser shell**

Reuse `renderBrowser(groups, options)` with explicit options rather than duplicating layouts:

```ts
interface StoreBrowserOptions {
  emptyTranslationKey: string;
  userHasSubscription?: boolean;
  trailingContent?: TemplateResult;
}
```

Pass `custom-currency-card` as `trailingContent` for packs. Keep tribes and merch on their purpose-built panels because they are not resolved cosmetic grids.

- [ ] **Step 5: Restyle CustomCurrencyCard without legacy ancestry**

Render a `data-custom-currency-card` article using the same dimensions, rarity strip, preview region, title region, and focus styles as common `CosmeticCard`. Keep its number/range inputs and standalone `PurchaseButton`; do not force a non-catalog custom amount into `ResolvedCosmetic`.

- [ ] **Step 6: Verify special products and purchase behavior**

```bash
npx vitest run tests/client/StoreModal.test.ts tests/client/CustomCurrencyCard.test.ts tests/client/PurchaseButton.test.ts tests/client/CosmeticPurchaseCompletion.test.ts
npx tsc --noEmit
```

Expected: all tests PASS and TypeScript exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/client/Store.ts src/client/components/CustomCurrencyCard.ts tests/client/StoreModal.test.ts tests/client/CustomCurrencyCard.test.ts
git commit -m "feat(store): migrate special products"
```

### Task 9: Migrate the win promotion and remove the legacy cosmetic stack

**Files:**

- Modify: `src/client/hud/layers/WinModal.ts`
- Modify: `tests/client/graphics/layers/WinModal.test.ts`
- Delete: `src/client/components/CosmeticButton.ts`
- Delete: `src/client/components/CosmeticContainer.ts`
- Delete: `src/client/components/CosmeticInfo.ts`
- Delete: `tests/client/CosmeticButton.test.ts`
- Modify: all remaining imports found by the obsolete-element scan.

**Interfaces:**

- Consumes: `CosmeticCard`, `PurchaseButton`, and `purchaseCosmetic`.
- Preserves: at most three shuffled purchasable patterns and direct purchase actions in the post-game promotion.

- [ ] **Step 1: Write a failing win-promotion composition test**

Extend `WinModal.test.ts` to invoke `loadPatternContent()` with four purchasable patterns and assert the rendered promo contains exactly three `cosmetic-card` elements, one purchase control per card, and no `cosmetic-button`/`cosmetic-container`.

- [ ] **Step 2: Run the win-modal test and verify RED**

```bash
npx vitest run tests/client/graphics/layers/WinModal.test.ts
```

Expected: FAIL because WinModal still renders `cosmetic-button`.

- [ ] **Step 3: Compose the win promotion from new primitives**

Render each promoted item as:

```ts
html`<div data-win-cosmetic-promo class="flex w-40 flex-col gap-2">
  <cosmetic-card .resolved=${resolved}></cosmetic-card>
  <purchase-button
    .product=${resolved.cosmetic?.product ?? null}
    .priceHard=${resolved.cosmetic?.priceHard ?? null}
    .priceSoft=${resolved.cosmetic?.priceSoft ?? null}
    .itemName=${cosmeticDisplayName(resolved)}
    .onPurchaseDollar=${() => purchaseCosmetic(resolved, "dollar")}
    .onPurchaseHard=${() => purchaseCosmetic(resolved, "hard")}
    .onPurchaseSoft=${() => purchaseCosmetic(resolved, "soft")}
  ></purchase-button>
</div>`;
```

Keep the existing shuffle and three-item limit unchanged.

- [ ] **Step 4: Delete legacy files and prove there are no consumers**

Delete the four listed files, then run:

```bash
rg -n "CosmeticButton|CosmeticContainer|CosmeticInfo|cosmetic-button|cosmetic-container|cosmetic-info" src tests
```

Expected: no results. If a result is an intentionally retained prose comment, rewrite the comment to refer to the new component; do not retain runtime imports/elements.

- [ ] **Step 5: Verify migrated consumers together**

```bash
npx vitest run tests/client/CosmeticPreview.test.ts tests/client/CosmeticCard.test.ts tests/client/CosmeticDetailPanel.test.ts tests/client/PurchaseButton.test.ts tests/client/InventoryModal.test.ts tests/client/EffectsGrid.test.ts tests/client/StoreModal.test.ts tests/client/CustomCurrencyCard.test.ts tests/client/graphics/layers/WinModal.test.ts
npx tsc --noEmit
```

Expected: all focused tests PASS and TypeScript exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/client/hud/layers/WinModal.ts tests/client/graphics/layers/WinModal.test.ts
git add -u src/client/components/CosmeticButton.ts src/client/components/CosmeticContainer.ts src/client/components/CosmeticInfo.ts tests/client/CosmeticButton.test.ts
git commit -m "refactor(cosmetics): remove legacy cards"
```

### Task 10: Integration, accessibility, responsive proof, and final gates

**Files:**

- Create: `tests/client/CosmeticLockerIntegration.test.ts`
- Modify only if a gate exposes a task-scoped defect: files introduced or migrated in Tasks 1–9.

**Interfaces:**

- Verifies the complete accepted spec; produces no new product API.

- [ ] **Step 1: Write the cross-surface integration test**

Mount Inventory and Store with the same catalog and user fixture. Assert:

```ts
it("separates Store inspection from Inventory equip state", async () => {
  await openInventory("skins");
  activateInventoryVariant(blue);
  expect(
    new UserSettings().getSelectedPatternName(catalog)?.colorPalette?.name,
  ).toBe("blue");

  await openStore("cosmetics");
  inspectStoreVariant(red);
  expect(storeDetail().resolved?.key).toBe(red.key);
  expect(
    new UserSettings().getSelectedPatternName(catalog)?.colorPalette?.name,
  ).toBe("blue");

  dispatchSettingsChange(PATTERN_KEY);
  expect(inventoryShowcase().resolved?.key).toBe(blue.key);
});
```

Also assert no nested interactive controls, native button semantics for cards and
swatches, phone layout markers (`overflow-x-auto`, two-column grid, stacked
detail), Inventory route/tab preservation, and no stale Store detail after an
empty category.

- [ ] **Step 2: Run the integration and translation tests**

```bash
npx vitest run tests/client/CosmeticLockerIntegration.test.ts tests/client/InventoryNavigation.test.ts tests/client/CosmeticPurchaseCompletion.test.ts tests/TranslationSystem.test.ts tests/EnJsonSorted.test.ts
```

Expected: all tests PASS.

- [ ] **Step 3: Run formatting and diff hygiene**

```bash
npx prettier --write src/client/components/CosmeticPreview.ts src/client/components/CosmeticPresentation.ts src/client/components/CosmeticCard.ts src/client/components/CosmeticDetailPanel.ts src/client/components/InventoryLoadoutBar.ts src/client/components/EffectsGrid.ts src/client/components/PurchaseButton.ts src/client/components/CustomCurrencyCard.ts src/client/InventoryModal.ts src/client/Store.ts src/client/hud/layers/WinModal.ts tests/client/CosmeticPreview.test.ts tests/client/CosmeticCard.test.ts tests/client/CosmeticDetailPanel.test.ts tests/client/PurchaseButton.test.ts tests/client/InventoryLoadoutBar.test.ts tests/client/EffectsGrid.test.ts tests/client/InventoryModal.test.ts tests/client/StoreModal.test.ts tests/client/CustomCurrencyCard.test.ts tests/client/CosmeticLockerIntegration.test.ts tests/client/graphics/layers/WinModal.test.ts resources/lang/en.json
git diff --check
```

Expected: Prettier completes and `git diff --check` is silent.

- [ ] **Step 4: Run static and production gates**

```bash
npx oxlint src/client/components/CosmeticPreview.ts src/client/components/CosmeticPresentation.ts src/client/components/CosmeticCard.ts src/client/components/CosmeticDetailPanel.ts src/client/components/InventoryLoadoutBar.ts src/client/components/EffectsGrid.ts src/client/components/PurchaseButton.ts src/client/components/CustomCurrencyCard.ts src/client/InventoryModal.ts src/client/Store.ts src/client/hud/layers/WinModal.ts tests/client/CosmeticPreview.test.ts tests/client/CosmeticCard.test.ts tests/client/CosmeticDetailPanel.test.ts tests/client/PurchaseButton.test.ts tests/client/InventoryLoadoutBar.test.ts tests/client/EffectsGrid.test.ts tests/client/InventoryModal.test.ts tests/client/StoreModal.test.ts tests/client/CustomCurrencyCard.test.ts tests/client/CosmeticLockerIntegration.test.ts tests/client/graphics/layers/WinModal.test.ts
npx eslint src/client/components/CosmeticPreview.ts src/client/components/CosmeticPresentation.ts src/client/components/CosmeticCard.ts src/client/components/CosmeticDetailPanel.ts src/client/components/InventoryLoadoutBar.ts src/client/components/EffectsGrid.ts src/client/components/PurchaseButton.ts src/client/components/CustomCurrencyCard.ts src/client/InventoryModal.ts src/client/Store.ts src/client/hud/layers/WinModal.ts tests/client/CosmeticPreview.test.ts tests/client/CosmeticCard.test.ts tests/client/CosmeticDetailPanel.test.ts tests/client/PurchaseButton.test.ts tests/client/InventoryLoadoutBar.test.ts tests/client/EffectsGrid.test.ts tests/client/InventoryModal.test.ts tests/client/StoreModal.test.ts tests/client/CustomCurrencyCard.test.ts tests/client/CosmeticLockerIntegration.test.ts tests/client/graphics/layers/WinModal.test.ts
npm run build-prod
```

Expected: lint, TypeScript, and Vite build exit 0. The existing chunk-size warning is non-blocking.

- [ ] **Step 5: Run the full repository suite**

```bash
npm test
```

Expected: both client/core and server Vitest runs pass with zero failures. The repository's existing MaxListeners warning is non-blocking.

- [ ] **Step 6: Run the browser smoke test**

Start the feature worktree with a catalog-capable environment. Verify at desktop and phone width:

1. Inventory loadout scroll/focus and category navigation.
2. Equipped showcase, card, badge, and colour swatch remain synchronized.
3. Colour swatch equips immediately with one activation.
4. Each Effects sub-slot changes the showcase and exact stored setting.
5. Store grid/detail selection and colour preview never change equipped settings.
6. Purchase controls receive the inspected variant up to the checkout boundary.
7. Keyboard focus is visible and Enter/Space work on cards and swatches.
8. Inventory and Store routes restore their active tab after refresh.

Capture the unavailable backend/browser as an explicit limitation rather than claiming the smoke test passed when it could not run.

- [ ] **Step 7: Commit integration proof**

```bash
git add tests/client/CosmeticLockerIntegration.test.ts
git commit -m "test(cosmetics): cover locker integration"
```
