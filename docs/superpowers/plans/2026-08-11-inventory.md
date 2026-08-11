# Inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a routed Inventory page where players can view and equip every owned cosmetic, including country flags, and remove the old lobby cosmetic selectors.

**Architecture:** Rename and extend the existing owned-cosmetics modal instead of duplicating its catalog and selection logic. Keep `resolveCosmetics`, `CosmeticButton`, `EffectsGrid`, and `UserSettings` as the ownership, presentation, and persistence seams; add Inventory routing to the existing desktop/mobile navigation and delete the superseded lobby selectors. Extract the checkout-return completion branch into `Cosmetics.ts` so its no-auto-equip behavior has a focused regression test.

**Tech Stack:** TypeScript 6, Lit 3, Tailwind utility classes, Vitest 4 with jsdom, Vite 8.

## Global Constraints

- Inventory is the only interface for changing the cosmetic loadout.
- Inventory categories are Skins, Flags, Crowns, and Effects.
- Only owned catalog cosmetics are shown; all unrestricted country flags and Default/None choices remain available.
- Selecting a tile equips it immediately and keeps Inventory open with selected-state feedback.
- Store purchases never change the equipped loadout.
- Preserve the existing `UserSettings` storage formats; add no server API, schema, dependency, or migration.
- Do not add presets, favorites, sorting, rarity filters, cosmetic counts, or in-game loadout changes.

---

## File Structure

- Create `src/client/InventoryModal.ts`: routed Inventory UI, category rendering, owned filtering, country-flag tiles, and equip actions.
- Delete `src/client/CosmeticsModal.ts`: replaced by `InventoryModal`.
- Delete `src/client/FlagInputModal.ts`: its country/cosmetic flag selection moves into Inventory.
- Delete `src/client/CosmeticsInput.ts` and `src/client/FlagInput.ts`: the lobby entry controls are removed.
- Modify `src/client/Cosmetics.ts`: add a small checkout-return completion function with no `UserSettings` dependency.
- Modify `src/client/Main.ts`: register Inventory, remove obsolete components/listeners, and delegate checkout completion.
- Modify `src/client/components/DesktopNavBar.ts` and `src/client/components/MobileNavBar.ts`: add routed Inventory entries.
- Modify `src/client/components/PlayPage.ts`: remove the flag/cosmetic controls while retaining username and cosmetic background preview.
- Modify `src/client/LangSelector.ts`: refresh `inventory-modal` on language changes and remove obsolete component tags.
- Modify `index.html`: replace the two old inline modals with one `page-inventory` element.
- Modify `resources/lang/en.json`: add `main.inventory` and Inventory-specific title/loading/error copy.
- Create `tests/client/CosmeticPurchaseCompletion.test.ts`: prove checkout returns do not mutate equipped settings.
- Create `tests/client/InventoryModal.test.ts`: cover ownership filtering, country flags, defaults, and equip persistence.
- Create `tests/client/InventoryNavigation.test.ts`: cover desktop/mobile entries and removal of lobby selectors.

---

### Task 1: Stop checkout returns from auto-equipping cosmetics

**Files:**
- Modify: `src/client/Cosmetics.ts:66-80`
- Modify: `src/client/Main.ts:746-774`
- Test: `tests/client/CosmeticPurchaseCompletion.test.ts`

**Interfaces:**
- Consumes: the parsed cosmetic name and optional login token from `Client.handleUrl()`.
- Produces: `completeCosmeticPurchaseReturn(cosmeticName: string, loginToken: string | null, actions: CosmeticPurchaseReturnActions): void`.

- [ ] **Step 1: Write the failing checkout-completion tests**

Create `tests/client/CosmeticPurchaseCompletion.test.ts` with action spies and seeded equipped values:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FLAG_KEY,
  PATTERN_KEY,
} from "../../src/core/game/UserSettings";
import { completeCosmeticPurchaseReturn } from "../../src/client/Cosmetics";

describe("completeCosmeticPurchaseReturn", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(PATTERN_KEY, "pattern:old");
    localStorage.setItem(FLAG_KEY, "country:us");
  });

  it("reports a completed purchase without changing the loadout", () => {
    const actions = {
      strip: vi.fn(),
      alertAndStrip: vi.fn(),
      openTokenLogin: vi.fn(),
      refreshStore: vi.fn(),
    };

    completeCosmeticPurchaseReturn("pattern:new", null, actions);

    expect(actions.alertAndStrip).toHaveBeenCalledWith(
      "purchase succeeded: pattern:new",
    );
    expect(actions.refreshStore).toHaveBeenCalledOnce();
    expect(localStorage.getItem(PATTERN_KEY)).toBe("pattern:old");
    expect(localStorage.getItem(FLAG_KEY)).toBe("country:us");
  });

  it("starts token login without installing an equip-on-unload action", () => {
    const actions = {
      strip: vi.fn(),
      alertAndStrip: vi.fn(),
      openTokenLogin: vi.fn(),
      refreshStore: vi.fn(),
    };

    completeCosmeticPurchaseReturn("flag:new", "login-token", actions);

    expect(actions.strip).toHaveBeenCalledOnce();
    expect(actions.openTokenLogin).toHaveBeenCalledWith("login-token");
    expect(actions.alertAndStrip).not.toHaveBeenCalled();
    expect(actions.refreshStore).not.toHaveBeenCalled();
    expect(localStorage.getItem(PATTERN_KEY)).toBe("pattern:old");
    expect(localStorage.getItem(FLAG_KEY)).toBe("country:us");
  });
});
```

- [ ] **Step 2: Run the test and confirm the new interface is missing**

Run:

```bash
npx vitest run tests/client/CosmeticPurchaseCompletion.test.ts
```

Expected: FAIL because `completeCosmeticPurchaseReturn` is not exported.

- [ ] **Step 3: Add the side-effect interface and minimal completion function**

Add near `PurchaseResult` in `src/client/Cosmetics.ts`:

```ts
export interface CosmeticPurchaseReturnActions {
  strip(): void;
  alertAndStrip(message: string): void;
  openTokenLogin(token: string): void;
  refreshStore(): void;
}

export function completeCosmeticPurchaseReturn(
  cosmeticName: string,
  loginToken: string | null,
  actions: CosmeticPurchaseReturnActions,
): void {
  if (loginToken) {
    actions.strip();
    actions.openTokenLogin(loginToken);
    return;
  }
  actions.alertAndStrip(`purchase succeeded: ${cosmeticName}`);
  actions.refreshStore();
}
```

Import it in `Main.ts` and replace the `setCosmetic` closure, `beforeunload` listener, and direct setting calls with:

```ts
completeCosmeticPurchaseReturn(
  cosmeticName,
  params.get("login-token"),
  {
    strip,
    alertAndStrip,
    openTokenLogin: (token) => this.tokenLoginModal.openWithToken(token),
    refreshStore: () => this.storeModal.refresh(),
  },
);
return;
```

Keep validation for the missing `cosmetic` parameter unchanged.

- [ ] **Step 4: Run the focused test and typecheck**

Run:

```bash
npx vitest run tests/client/CosmeticPurchaseCompletion.test.ts
npx tsc --noEmit
```

Expected: both commands PASS, and `rg -n "setCosmetic|beforeunload.*cosmetic" src/client/Main.ts` returns no checkout auto-equip path.

- [ ] **Step 5: Commit the checkout behavior**

```bash
git add src/client/Cosmetics.ts src/client/Main.ts tests/client/CosmeticPurchaseCompletion.test.ts
git commit -m "fix(cosmetics): stop auto-equipping purchases"
```

---

### Task 2: Turn the owned-cosmetics modal into Inventory

**Files:**
- Create: `src/client/InventoryModal.ts`
- Delete: `src/client/CosmeticsModal.ts`
- Modify: `resources/lang/en.json:426-450,990-1015`
- Test: `tests/client/InventoryModal.test.ts`

**Interfaces:**
- Consumes: `fetchCosmetics(): Promise<Cosmetics | null>`, `resolveCosmetics(...)`, `groupCosmeticVariants(...)`, the document `userMeResponse` event, `Countries`, and the existing `UserSettings` selection methods.
- Produces: custom element `<inventory-modal>`, class `InventoryModal`, route name `inventory`, and tabs `skins | flags | crowns | effects`.

- [ ] **Step 1: Write failing Inventory rendering and equip tests**

Create `tests/client/InventoryModal.test.ts`. Build a catalog fixture containing one owned and one unowned skin/flag/crown/effect, and a `UserMeResponse` whose flares grant only the owned entries. Install state directly, matching existing modal rendering tests:

```ts
import type { LitElement } from "lit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { UserMeResponse } from "../../src/core/ApiSchemas";
import type { Cosmetics } from "../../src/core/CosmeticSchemas";
import { UserSettings } from "../../src/core/game/UserSettings";
import { InventoryModal } from "../../src/client/InventoryModal";
import type { CosmeticButton } from "../../src/client/components/CosmeticButton";

const common = {
  product: null,
  rarity: "common",
  affiliateCode: null,
} as const;

const catalog = {
  patterns: {},
  flags: {
    owned_flag: { ...common, name: "owned_flag", url: "/flags/owned.svg" },
    locked_flag: { ...common, name: "locked_flag", url: "/flags/locked.svg" },
  },
  crowns: {
    owned_crown: { ...common, name: "owned_crown", url: "/crowns/owned.svg" },
    locked_crown: { ...common, name: "locked_crown", url: "/crowns/locked.svg" },
  },
  skins: {
    owned_skin: { ...common, name: "owned_skin", url: "/skins/owned.png" },
    locked_skin: { ...common, name: "locked_skin", url: "/skins/locked.png" },
  },
  effects: {
    transportShipTrail: {
      owned_wake: {
        ...common,
        name: "owned_wake",
        effectType: "transportShipTrail",
        attributes: {
          type: "gradient",
          colors: ["#ffffff"],
          colorSize: 1,
          movementSpeed: 1,
        },
      },
      locked_wake: {
        ...common,
        name: "locked_wake",
        effectType: "transportShipTrail",
        attributes: {
          type: "gradient",
          colors: ["#000000"],
          colorSize: 1,
          movementSpeed: 1,
        },
      },
    },
  },
} as unknown as Cosmetics;

const ownedUser = {
  user: {},
  player: {
    publicId: "inventory-test-player",
    adfree: false,
    unlimitedRanked: false,
    canCreatePublicLobbies: false,
    achievements: { singleplayerMap: [] },
    friends: [],
    subscription: null,
    currency: { soft: 0, hard: 0 },
    flares: [
      "skin:owned_skin",
      "flag:owned_flag",
      "crown:owned_crown",
      "effect:owned_wake",
    ],
  },
} as unknown as UserMeResponse;

function tile(modal: InventoryModal, key: string): CosmeticButton | undefined {
  return [...modal.querySelectorAll<CosmeticButton>("cosmetic-button")].find(
    (button) => button.resolved.key === key,
  );
}

async function showTab(
  modal: InventoryModal,
  tab: "skins" | "flags" | "crowns" | "effects",
) {
  modal.setActiveTab(tab);
  await modal.updateComplete;
  const effects = modal.querySelector("effects-grid");
  if (effects) await (effects as LitElement).updateComplete;
}

describe("InventoryModal", () => {
  let modal: InventoryModal;

  beforeEach(async () => {
    localStorage.clear();
    modal = document.createElement("inventory-modal") as InventoryModal;
    modal.setAttribute("inline", "");
    document.body.appendChild(modal);
    Object.assign(modal as unknown as Record<string, unknown>, {
      cosmetics: catalog as Cosmetics,
      userMeResponse: ownedUser as UserMeResponse,
      isLoading: false,
      loadFailed: false,
    });
    modal.requestUpdate();
    await modal.updateComplete;
  });

  afterEach(() => modal.remove());

  it("has the four equip categories", () => {
    const config = (
      modal as unknown as { modalConfig(): { tabs: Array<{ key: string }> } }
    ).modalConfig();
    expect(config.tabs.map((tab) => tab.key)).toEqual([
      "skins",
      "flags",
      "crowns",
      "effects",
    ]);
  });

  it("shows owned skins plus Default and equips without closing", async () => {
    await showTab(modal, "skins");
    expect(tile(modal, "pattern:default")).toBeDefined();
    expect(tile(modal, "skin:owned_skin")).toBeDefined();
    expect(tile(modal, "skin:locked_skin")).toBeUndefined();
    tile(modal, "skin:owned_skin")!.onSelect!(
      tile(modal, "skin:owned_skin")!.resolved,
    );
    expect(new UserSettings().getSelectedSkinName()).toBe("owned_skin");
    expect(modal.isConnected).toBe(true);
  });

  it("shows owned cosmetic flags and unrestricted country flags", async () => {
    await showTab(modal, "flags");
    expect(tile(modal, "flag:owned_flag")).toBeDefined();
    expect(tile(modal, "flag:locked_flag")).toBeUndefined();
    expect(tile(modal, "country:xx")).toBeDefined();
    expect(tile(modal, "country:us")).toBeDefined();
    expect(tile(modal, "country:German Empire")).toBeUndefined();
    tile(modal, "country:us")!.onSelect!(tile(modal, "country:us")!.resolved);
    expect(new UserSettings().getFlag()).toBe("country:us");
  });

  it("clears crowns and effects through their None tiles", async () => {
    const settings = new UserSettings();
    settings.setSelectedCrownName("owned_crown");
    settings.setSelectedEffectName("transportShipTrail", "owned_wake");

    await showTab(modal, "crowns");
    tile(modal, "crown:none")!.onSelect!(tile(modal, "crown:none")!.resolved);
    expect(settings.getSelectedCrownName()).toBeNull();

    await showTab(modal, "effects");
    const none = tile(modal, "effect:none:transportShipTrail")!;
    none.onSelect!(none.resolved);
    expect(settings.getSelectedEffectName("transportShipTrail")).toBeNull();
  });

  it("shows a non-destructive failure state", async () => {
    const settings = new UserSettings();
    settings.setSelectedCrownName("owned_crown");
    Object.assign(modal as unknown as Record<string, unknown>, {
      cosmetics: null,
      isLoading: false,
      loadFailed: true,
    });
    modal.requestUpdate();
    await modal.updateComplete;

    expect(modal.querySelector('[data-inventory-state="error"]')).toBeTruthy();
    expect(modal.querySelector("cosmetic-button")).toBeNull();
    expect(settings.getSelectedCrownName()).toBe("owned_crown");
  });
});
```

- [ ] **Step 2: Run the test and confirm the Inventory module is missing**

Run:

```bash
npx vitest run tests/client/InventoryModal.test.ts
```

Expected: FAIL because `src/client/InventoryModal.ts` does not exist.

- [ ] **Step 3: Rename the modal and establish Inventory state**

Move the implementation from `CosmeticsModal.ts` to `InventoryModal.ts`, then make these identity changes:

```ts
@customElement("inventory-modal")
export class InventoryModal extends BaseModal {
  protected routerName = "inventory";

  @state() private isLoading = true;
  @state() private loadFailed = false;

  protected modalConfig() {
    return {
      tabs: [
        { key: "skins", label: translateText("store.patterns") },
        { key: "flags", label: translateText("store.flags") },
        { key: "crowns", label: translateText("store.crowns") },
        { key: "effects", label: translateText("store.effects") },
      ],
    };
  }
}
```

Change the header to `translateText("inventory.title")`. When catalog loading finishes, set `isLoading = false` and `loadFailed = cosmetics === null`; neither path may write `UserSettings`.

Use one loader from both the user event and first open so direct navigation works even if the event arrived before the element was connected:

```ts
private async loadCatalog(): Promise<void> {
  this.isLoading = true;
  this.loadFailed = false;
  this.cosmetics = await fetchCosmetics();
  this.loadFailed = this.cosmetics === null;
  this.isLoading = false;
  await this.updateFromSettings();
  this.refresh();
}

async onUserMe(userMeResponse: UserMeResponse | false) {
  this.userMeResponse = userMeResponse;
  await this.loadCatalog();
}

protected async onOpen(): Promise<void> {
  if (this.cosmetics === null && !this.loadFailed) {
    await this.loadCatalog();
    return;
  }
  await this.updateFromSettings();
  this.refresh();
}
```

- [ ] **Step 4: Move flag construction and selection into Inventory**

Import `Countries`, `assetUrl`, and `Flag`. Add the same country flag adapter used by the old picker:

```ts
function countryFlag(name: string, code: string): Flag {
  return {
    name,
    url: assetUrl(`/flags/${code}.svg`),
    product: null,
    rarity: "common",
    affiliateCode: null,
  };
}
```

Implement `renderFlagGrid()` with this exact ordering and filtering:

1. `country:xx` when search is empty.
2. Catalog flags from `resolveCosmetics(...).filter(r => r.type === "flag" && r.relationship === "owned")`.
3. `Countries` entries where `code !== "xx"`, `restricted !== true`, and name or code matches search.

Each tile is a `ResolvedCosmetic` with `relationship: "owned"`; selection calls `this.userSettings.setFlag(key)` and `this.refresh()` without closing Inventory. Add `tab === "flags"` to `renderBody`.

- [ ] **Step 5: Add loading, failure, and Store navigation states**

At the start of `renderBody`, return localized non-interactive states before rendering category tiles:

```ts
if (this.isLoading) {
  return html`<div
    data-inventory-state="loading"
    class="p-8 text-center text-white/60"
  >
    ${translateText("inventory.loading")}
  </div>`;
}
if (this.loadFailed) {
  return html`<div
    data-inventory-state="error"
    class="p-8 text-center text-red-300"
  >
    ${translateText("inventory.load_failed")}
  </div>`;
}
```

Keep the existing Store button above the active grid and keep search scoped to the active category. Add these English keys:

```json
"inventory": {
  "load_failed": "Couldn't load your inventory. Please reload and try again.",
  "loading": "Loading inventory…",
  "title": "Inventory"
}
```

Add `"inventory": "Inventory"` under `main`. Other languages use the existing English fallback until translated.

- [ ] **Step 6: Run Inventory tests and typecheck**

Run:

```bash
npx vitest run tests/client/InventoryModal.test.ts tests/client/CosmeticButton.test.ts
npx tsc --noEmit
```

Expected: all tests and typecheck PASS.

- [ ] **Step 7: Commit the Inventory surface**

```bash
git add src/client/InventoryModal.ts src/client/CosmeticsModal.ts resources/lang/en.json tests/client/InventoryModal.test.ts
git commit -m "feat(inventory): add owned cosmetic selector"
```

---

### Task 3: Add Inventory navigation and remove lobby selectors

**Files:**
- Modify: `src/client/components/DesktopNavBar.ts:96-121`
- Modify: `src/client/components/MobileNavBar.ts:112-140`
- Modify: `src/client/components/PlayPage.ts:119-153`
- Modify: `src/client/Main.ts:17-40,197-248,285-389,962-974`
- Modify: `src/client/LangSelector.ts:206-250`
- Modify: `index.html:240-300`
- Delete: `src/client/CosmeticsInput.ts`
- Delete: `src/client/FlagInput.ts`
- Delete: `src/client/FlagInputModal.ts`
- Test: `tests/client/InventoryNavigation.test.ts`

**Interfaces:**
- Consumes: `<inventory-modal>`, `window.showPage`, `ModalRouter`, and the existing `.nav-menu-item[data-page]` delegation.
- Produces: page id `page-inventory`, hash route `#modal=inventory&tab=<category>`, and desktop/mobile nav entries labeled by `main.inventory`.

- [ ] **Step 1: Write failing navigation and lobby-removal tests**

Create `tests/client/InventoryNavigation.test.ts`:

```ts
import type { LitElement } from "lit";
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopNavBar } from "../../src/client/components/DesktopNavBar";
import { MobileNavBar } from "../../src/client/components/MobileNavBar";
import { PlayPage } from "../../src/client/components/PlayPage";

async function mount<T extends LitElement>(element: T): Promise<T> {
  document.body.appendChild(element);
  await element.updateComplete;
  return element;
}

afterEach(() => document.body.replaceChildren());

describe("Inventory navigation", () => {
  it("renders Inventory in desktop and mobile navigation", async () => {
    const desktop = await mount(new DesktopNavBar());
    const mobile = await mount(new MobileNavBar());
    expect(
      desktop.querySelector('[data-page="page-inventory"][data-i18n="main.inventory"]'),
    ).toBeTruthy();
    expect(mobile.querySelector('[data-page="page-inventory"]')).toBeTruthy();
    expect(
      mobile.querySelector('[data-page="page-inventory"] [data-i18n="main.inventory"], [data-page="page-inventory"][data-i18n="main.inventory"]'),
    ).toBeTruthy();
  });

  it("removes cosmetic and flag selectors from the play page", async () => {
    const play = await mount(new PlayPage());
    expect(play.querySelector("cosmetics-input")).toBeNull();
    expect(play.querySelector("flag-input")).toBeNull();
    expect(play.querySelector("username-input")).toBeTruthy();
  });

  it("declares only the routed Inventory page in index.html", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");
    expect(source).toContain('<inventory-modal\n          id="page-inventory"');
    expect(source).not.toContain("<cosmetics-modal");
    expect(source).not.toContain("<flag-input-modal");
  });
});
```

- [ ] **Step 2: Run the test and confirm old navigation/UI remains**

Run:

```bash
npx vitest run tests/client/InventoryNavigation.test.ts
```

Expected: FAIL because there is no `page-inventory` nav entry and the old play-page selectors still render.

- [ ] **Step 3: Add desktop and mobile Inventory entries**

Place Inventory immediately after Store in each navigation component. Desktop uses the same button classes and active expression as neighboring entries:

```ts
<button
  class="nav-menu-item ${currentPage === "page-inventory"
    ? "active"
    : ""} text-white/70 hover:text-malibu-blue font-medium tracking-wider uppercase cursor-pointer transition-colors [&.active]:text-malibu-blue"
  data-page="page-inventory"
  data-i18n="main.inventory"
></button>
```

Mobile uses its existing full-width nav button classes with `data-page="page-inventory"` and `data-i18n="main.inventory"`. Do not add `no-crazygames`; Inventory must remain reachable for country-flag selection.

- [ ] **Step 4: Register and mount the routed Inventory page**

Replace the old imports in `Main.ts` with:

```ts
import "./InventoryModal";
import { InventoryModal } from "./InventoryModal";
```

Register the page:

```ts
modalRouter.register("inventory", {
  tag: "inventory-modal",
  pageId: "page-inventory",
});
```

Replace both old inline elements in `index.html` with:

```html
<inventory-modal
  id="page-inventory"
  inline
  class="hidden w-full h-full page-content relative z-50"
></inventory-modal>
```

Update modal shutdown lists and `LangSelector` to use `inventory-modal`. Remove registration, lookup, and click-listener code for `cosmetics-modal`, `flag-input-modal`, `cosmetics-input`, and `flag-input`.

- [ ] **Step 5: Remove the lobby controls and obsolete source files**

In `PlayPage`, retain `cosmetic-background` and `username-input`, but remove both selector elements. Update the identity-row comments and allow username to occupy the full control row:

```ts
<div
  class="relative z-10 flex h-full w-full min-w-0 items-center bg-surface/80 p-1 sm:rounded-xl"
>
  <username-input class="flex-1 min-w-0 h-10 sm:h-[50px]"></username-input>
</div>
```

Delete `CosmeticsInput.ts`, `FlagInput.ts`, and `FlagInputModal.ts` after `rg -n "CosmeticsInput|FlagInputModal|<cosmetics-input|<flag-input" src index.html` confirms only the removal targets remain.

- [ ] **Step 6: Run navigation tests and focused cleanup checks**

Run:

```bash
npx vitest run tests/client/InventoryNavigation.test.ts tests/client/InventoryModal.test.ts
npx tsc --noEmit
rg -n "cosmetics-modal|flag-input-modal|cosmetics-input|flag-input" src index.html
```

Expected: tests and typecheck PASS; the final search returns no obsolete component registration or markup. References to translation namespaces or generic cosmetic/flag concepts are allowed only if they do not name the deleted custom elements.

- [ ] **Step 7: Commit navigation and cleanup**

```bash
git add index.html resources/lang/en.json src/client/Main.ts src/client/LangSelector.ts src/client/components/DesktopNavBar.ts src/client/components/MobileNavBar.ts src/client/components/PlayPage.ts src/client/CosmeticsInput.ts src/client/FlagInput.ts src/client/FlagInputModal.ts tests/client/InventoryNavigation.test.ts
git commit -m "feat(inventory): add navigation entry"
```

---

### Task 4: Verify the complete Inventory flow

**Files:**
- Modify only if a verification failure identifies a task-scoped defect in files listed above.

**Interfaces:**
- Consumes: the completed Inventory page, navigation, checkout behavior, and existing client build.
- Produces: evidence that the accepted flow works without unrelated changes.

- [ ] **Step 1: Format the changed files and inspect the diff**

Run Prettier only on files changed by this feature, then inspect scope:

```bash
npx prettier --write src/client/Cosmetics.ts src/client/InventoryModal.ts src/client/Main.ts src/client/LangSelector.ts src/client/components/DesktopNavBar.ts src/client/components/MobileNavBar.ts src/client/components/PlayPage.ts resources/lang/en.json tests/client/CosmeticPurchaseCompletion.test.ts tests/client/InventoryModal.test.ts tests/client/InventoryNavigation.test.ts index.html
git diff --check
git status --short
```

Expected: formatting succeeds, `git diff --check` is silent, and status contains only feature files.

- [ ] **Step 2: Run focused regression tests**

```bash
npx vitest run tests/client/CosmeticPurchaseCompletion.test.ts tests/client/InventoryModal.test.ts tests/client/InventoryNavigation.test.ts tests/client/CosmeticButton.test.ts tests/ResolveCosmetics.test.ts tests/CosmeticRelationship.test.ts
```

Expected: all focused tests PASS.

- [ ] **Step 3: Run static and production build gates**

```bash
npx oxlint src/client/Cosmetics.ts src/client/InventoryModal.ts src/client/Main.ts src/client/LangSelector.ts src/client/components/DesktopNavBar.ts src/client/components/MobileNavBar.ts src/client/components/PlayPage.ts tests/client/CosmeticPurchaseCompletion.test.ts tests/client/InventoryModal.test.ts tests/client/InventoryNavigation.test.ts
npx eslint src/client/Cosmetics.ts src/client/InventoryModal.ts src/client/Main.ts src/client/LangSelector.ts src/client/components/DesktopNavBar.ts src/client/components/MobileNavBar.ts src/client/components/PlayPage.ts tests/client/CosmeticPurchaseCompletion.test.ts tests/client/InventoryModal.test.ts tests/client/InventoryNavigation.test.ts
npm run build-prod
```

Expected: lint, TypeScript, and production client build PASS.

- [ ] **Step 4: Exercise the browser path**

Start the development server, open the shared preview, and verify:

1. Desktop top bar and mobile menu both show Inventory beside Store.
2. Inventory opens and the URL becomes `#modal=inventory&tab=skins` (or the selected category).
3. Skins, Flags, Crowns, and Effects show owned items only.
4. Flags includes None and unrestricted country flags.
5. Clicking each item type updates selected styling without closing Inventory.
6. Default/None clears the corresponding slot.
7. The play page has no cosmetic or flag selector buttons.
8. Store remains purchase-only and a completed purchase does not replace the equipped item.

- [ ] **Step 5: Commit verification-only fixes if needed**

If Steps 1-4 required code corrections, stage only those corrections and use:

```bash
git commit -m "fix(inventory): resolve integration regressions"
```

If no corrections were needed, do not create an empty commit.
