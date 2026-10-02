import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { closeMobileSidebar, markVersionSeen, notificationState } = vi.hoisted(
  () => ({
    closeMobileSidebar: vi.fn(),
    markVersionSeen: vi.fn(),
    notificationState: {
      hasNewVersion: true,
      requests: [
        {
          publicId: "friend.1234",
          username: "friend.1234",
          createdAt: "2026-10-02T12:00:00.000Z",
        },
      ],
    },
  }),
);

vi.mock("../../src/client/DesktopShell", () => ({
  desktopQuit: () => null,
  requestDesktopQuit: vi.fn(),
}));
vi.mock("../../src/client/Navigation", () => ({ closeMobileSidebar }));
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: Record<string, string | number>) => {
    if (key === "notifications.new_version") {
      return `Version ${params?.version} is now live`;
    }
    return key;
  },
}));
vi.mock("../../src/client/components/NavNotificationsController", () => ({
  NavNotificationsController: class {
    currentVersion = () => "v9.9.9";
    friendRequests = () => notificationState.requests;
    hasNewVersion = () => notificationState.hasNewVersion;
    markVersionSeen = markVersionSeen;
    onHelpClick = vi.fn();
    onStoreClick = vi.fn();
    showBellDot = () =>
      notificationState.hasNewVersion || notificationState.requests.length > 0;
    showHelpDot = () => false;
  },
}));

import "../../src/client/components/NavUtilityIcons";

type Mountable = HTMLElement & { updateComplete: Promise<unknown> };

async function mount(): Promise<Mountable> {
  const element = document.createElement("nav-utility-icons") as Mountable;
  document.body.appendChild(element);
  await element.updateComplete;
  return element;
}

function trigger(element: ParentNode): HTMLButtonElement {
  return element.querySelector<HTMLButtonElement>(
    "[data-notifications-trigger]",
  )!;
}

async function openMenu(element: Mountable): Promise<HTMLElement> {
  trigger(element).click();
  await element.updateComplete;
  return document.querySelector<HTMLElement>('[role="menu"]')!;
}

describe("nav notification menu", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    history.replaceState(null, "", window.location.pathname);
    notificationState.hasNewVersion = true;
    notificationState.requests = [
      {
        publicId: "friend.1234",
        username: "friend.1234",
        createdAt: "2026-10-02T12:00:00.000Z",
      },
    ];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("turns the bell into an accessible menu trigger instead of a News link", async () => {
    const element = await mount();
    const bell = trigger(element);

    expect(bell.hasAttribute("data-page")).toBe(false);
    expect(bell.getAttribute("aria-haspopup")).toBe("menu");
    expect(bell.getAttribute("aria-expanded")).toBe("false");

    const menu = await openMenu(element);

    expect(menu).not.toBeNull();
    expect(bell.getAttribute("aria-expanded")).toBe("true");
    // Looking at the list does not dismiss its version notification.
    expect(markVersionSeen).not.toHaveBeenCalled();
  });

  it("opens release notes and marks the version seen only when selected", async () => {
    const element = await mount();
    const menu = await openMenu(element);
    const versionRow = Array.from(menu.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Version v9.9.9 is now live"),
    )!;

    versionRow.click();
    await element.updateComplete;

    expect(markVersionSeen).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe("#modal=news");
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("routes friend requests to the existing Friends tab", async () => {
    const element = await mount();
    const menu = await openMenu(element);
    const friendRow = Array.from(menu.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("friend"),
    )!;

    friendRow.click();
    await element.updateComplete;

    expect(window.location.hash).toBe("#modal=account&tab=friends");
    expect(markVersionSeen).not.toHaveBeenCalled();
    expect(closeMobileSidebar).toHaveBeenCalled();
  });

  it("closes on Escape and removes its body portal on disconnect", async () => {
    const element = await mount();
    const menu = await openMenu(element);
    const items = menu.querySelectorAll<HTMLElement>('[role="menuitem"]');
    expect(document.activeElement).toBe(items[0]);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    expect(document.activeElement).toBe(items[1]);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await element.updateComplete;
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger(element));

    await openMenu(element);
    element.remove();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});
