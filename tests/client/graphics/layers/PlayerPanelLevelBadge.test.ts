vi.mock("lit", () => ({
  html: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
  LitElement: class extends EventTarget {
    requestUpdate() {}
  },
}));

vi.mock("lit/decorators.js", () => ({
  customElement: () => (clazz: unknown) => clazz,
  state: () => () => {},
  property: () => () => {},
  query: () => () => {},
}));

vi.mock("../../../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
  renderDuration: vi.fn(),
  renderNumber: vi.fn(),
  renderTroops: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("../../../../src/client/components/ui/ActionButton", () => ({
  actionButton: vi.fn((props: unknown) => props),
}));

vi.mock("../../../../src/client/components/LevelBadge", () => ({}));

vi.mock("../../../../src/client/InGameModal", () => ({
  showInGameConfirm: vi.fn(),
  showInGameAlert: vi.fn(),
}));

import { PlayerPanel } from "../../../../src/client/hud/layers/PlayerPanel";
import { rememberLobbyRoster } from "../../../../src/client/LobbyRosterLevels";
import { PlayerView } from "../../../../src/client/view";
import { PlayerType } from "../../../../src/core/game/Game";
import { UserSettings } from "../../../../src/core/game/UserSettings";
import { packLevelBadge } from "../../../../src/core/LevelBadgeWire";

// With lit mocked, html`` yields { strings, values }: flatten one back into
// markup so the identity row can be checked as text.
function flatten(value: unknown): string {
  if (Array.isArray(value)) return value.map(flatten).join("");
  if (value && typeof value === "object" && "strings" in value) {
    const t = value as { strings: readonly string[]; values: unknown[] };
    return t.strings
      .map((s, i) => s + (i < t.values.length ? flatten(t.values[i]) : ""))
      .join("");
  }
  if (typeof value === "function" || value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function player(
  clientID: string | null,
  type: PlayerType = PlayerType.Human,
): PlayerView {
  return {
    id: () => clientID ?? "bot",
    displayName: () => `name-${clientID}`,
    type: () => type,
    clientID: () => clientID,
    cosmetics: { flag: "/flags/gb.svg" },
  } as unknown as PlayerView;
}

describe("PlayerPanel - level badge", () => {
  let panel: PlayerPanel;

  beforeEach(() => {
    localStorage.clear();
    (
      UserSettings as unknown as { cache: Map<string, string | null> }
    ).cache.clear();
    rememberLobbyRoster("game-1", [
      {
        clientID: "me",
        username: "me",
        clanTag: null,
        levelBadge: packLevelBadge({ level: 12, prestige: 0, legend: false }),
      },
      {
        clientID: "vet",
        username: "vet",
        clanTag: null,
        levelBadge: packLevelBadge({ level: 42, prestige: 3, legend: true }),
      },
      { clientID: "guest", username: "guest", clanTag: null },
    ]);
    panel = new PlayerPanel();
    (panel as any).g = {
      gameID: () => "game-1",
      myClientID: () => "me",
    };
    (panel as any).renderTraitorBadge = () => "";
    (panel as any).renderRelationPillIfNation = () => "";
  });

  const row = (other: PlayerView) =>
    flatten((panel as any).renderIdentityRow(other, player("me")));

  test("shows a 28px badge between the flag and the name", () => {
    const out = row(player("vet"));

    const flag = out.indexOf("<img");
    const badge = out.indexOf("<level-badge");
    const name = out.indexOf("<h2");
    expect(flag).toBeGreaterThanOrEqual(0);
    expect(badge).toBeGreaterThan(flag);
    expect(name).toBeGreaterThan(badge);

    const tag = out.slice(badge, out.indexOf("</level-badge>"));
    expect(tag).toContain('size="28"');
    expect(tag).toContain(".level=42");
    expect(tag).toContain(".prestige=3");
    expect(tag).toContain("?legend=true");
  });

  test("keeps the name truncating beside the badge", () => {
    const out = row(player("vet"));
    const h2 = out.slice(out.indexOf("<h2"), out.indexOf("</h2>"));
    expect(h2).toContain("min-w-0");
    expect(h2).toContain("truncate");
  });

  test("shows nothing for a human with no roster badge", () => {
    expect(row(player("guest"))).not.toContain("<level-badge");
    expect(row(player("stranger"))).not.toContain("<level-badge");
  });

  test("shows nothing for bots and nations", () => {
    expect(row(player(null, PlayerType.Bot))).not.toContain("<level-badge");
    expect(row(player(null, PlayerType.Nation))).not.toContain("<level-badge");
    // Even if a non-human somehow carried a roster client id.
    expect(row(player("vet", PlayerType.Nation))).not.toContain("<level-badge");
  });

  test("shows nothing when the roster is from another game", () => {
    (panel as any).g.gameID = () => "game-2";
    expect(row(player("vet"))).not.toContain("<level-badge");
  });

  test("with anonymous names on, hides others' badges but not your own", () => {
    new UserSettings().toggleRandomName();

    expect(row(player("vet"))).not.toContain("<level-badge");
    const own = row(player("me"));
    expect(own).toContain("<level-badge");
    expect(own).toContain(".level=12");
  });
});
