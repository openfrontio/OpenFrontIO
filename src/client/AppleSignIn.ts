import { decodeJwt } from "jose";
import { getApiBase } from "./Api";
import { getAuthHeader } from "./Auth";
import { ClientEnv } from "./ClientEnv";
import { isDesktopShell } from "./DesktopShell";
import { showInGameAlert } from "./InGameModal";
import { translateText } from "./Utils";

// Sign in with Apple on the website (OPE-852). Apple's JS library runs in
// popup mode and hands the page an authorization code, which goes to the same
// API routes the iOS app uses. Design: infra's docs/ios-auth-payments.md §2.

const APPLE_SCRIPT_URL =
  "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js";

// Each site's Services ID, keyed by its host (which is also its audience). A
// site without one has no Apple button: the API answers 501 until that
// environment is configured.
const SERVICES_IDS: Record<string, string> = {
  "openfront.io": "io.openfront.web",
  "openfront.dev": "io.openfront.web.staging",
};

interface AppleSignInResponse {
  authorization: { code: string; id_token: string; state?: string };
  // Sent only the first time this Apple account authorizes our apps.
  user?: unknown;
}

declare global {
  interface Window {
    AppleID?: {
      auth: {
        init(config: {
          clientId: string;
          scope: string;
          redirectURI: string;
          usePopup: boolean;
        }): void;
        signIn(): Promise<AppleSignInResponse>;
      };
    };
  }
}

/**
 * The Services ID to sign in with here, or null when the Apple button must
 * not show.
 *
 * Only on the website, and only at the site's own origin: Apple returns the
 * popup's result to the registered return URL's origin, so a branch preview,
 * localhost, the Steam shell (`app://openfront`) and the Android WebView would
 * all get a popup that never answers. The iOS app uses its native sheet.
 */
export function appleServicesId(): string | null {
  if (isDesktopShell()) return null;
  const host = window.location.hostname;
  const id = SERVICES_IDS[host];
  if (id === undefined) return null;
  if (window.location.origin !== `https://${host}`) return null;
  // The return URL is built from the audience, so the two must agree.
  if (ClientEnv.jwtAudience() !== host) return null;
  return id;
}

let scriptPromise: Promise<void> | null = null;

function loadAppleScript(): Promise<void> {
  if (window.AppleID) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = APPLE_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      script.remove();
      reject(new Error("Failed to load Sign in with Apple"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

type PopupResult =
  | { status: "ok"; code: string; hiddenEmail: boolean; firstTime: boolean }
  | { status: "cancelled" }
  | { status: "failed" };

// The player closing the popup or pressing Cancel is not an error.
const CANCELLED = new Set(["popup_closed_by_user", "user_cancelled_authorize"]);

async function applePopup(servicesId: string): Promise<PopupResult> {
  try {
    await loadAppleScript();
    const appleId = window.AppleID;
    if (!appleId) return { status: "failed" };
    appleId.auth.init({
      clientId: servicesId,
      scope: "email",
      // Must match the API's redirect_uri for `client: "web"` exactly.
      redirectURI: `https://${ClientEnv.jwtAudience()}/`,
      usePopup: true,
    });
    const response = await appleId.auth.signIn();
    return {
      status: "ok",
      code: response.authorization.code,
      hiddenEmail: isPrivateEmail(response.authorization.id_token),
      firstTime: response.user !== undefined,
    };
  } catch (e) {
    const code = (e as { error?: unknown } | null)?.error;
    if (typeof code === "string" && CANCELLED.has(code)) {
      return { status: "cancelled" };
    }
    console.warn("Sign in with Apple failed", e);
    return { status: "failed" };
  }
}

// Read for the sign-up notice only; the API verifies the token it gets from
// Apple itself. Apple sends the claim as a boolean or as a string.
function isPrivateEmail(idToken: string): boolean {
  try {
    const claim = decodeJwt(idToken).is_private_email;
    return claim === true || claim === "true";
  } catch {
    return false;
  }
}

async function reasonOf(response: Response): Promise<unknown> {
  const body = await response.json().catch(() => null);
  return (body as { reason?: unknown } | null)?.reason;
}

export async function appleLogin(): Promise<void> {
  const servicesId = appleServicesId();
  if (servicesId === null) return;
  const result = await applePopup(servicesId);
  if (result.status === "cancelled") return;
  if (result.status === "failed") {
    void showInGameAlert(translateText("account_modal.apple_sign_in_failed"));
    return;
  }
  try {
    const response = await fetch(`${getApiBase()}/auth/apple`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: result.code, client: "web" }),
      credentials: "include",
    });
    if (response.ok) {
      // A hidden email never matches an existing account, so a first sign-in
      // with one always made a new account. Say so before the page reloads
      // into it, with the way back to an account the player already has.
      if (result.hiddenEmail && result.firstTime) {
        await showInGameAlert(
          translateText("account_modal.apple_hidden_email_new_account"),
        );
      }
      // The response set the refresh cookie, as for Google's native sheet.
      window.location.reload();
      return;
    }
    console.error("Apple sign-in failed", response.status);
    const emailExists =
      response.status === 409 && (await reasonOf(response)) === "email_exists";
    void showInGameAlert(
      translateText(
        emailExists
          ? "account_modal.login_email_exists"
          : "account_modal.apple_sign_in_failed",
      ),
    );
  } catch (e) {
    console.warn("Apple sign-in failed", e);
    void showInGameAlert(translateText("account_modal.apple_sign_in_failed"));
  }
}

// Link Apple to the signed-in player. Returns false only when the player is
// not signed in; every other outcome is reported here.
export async function linkApple(): Promise<boolean> {
  const servicesId = appleServicesId();
  if (servicesId === null) return false;
  const authHeader = await getAuthHeader();
  if (authHeader === "") return false;
  const result = await applePopup(servicesId);
  if (result.status === "cancelled") return true;
  if (result.status === "failed") {
    void showInGameAlert(translateText("account_modal.link_apple_error"));
    return true;
  }
  try {
    const response = await fetch(`${getApiBase()}/auth/apple/link`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code: result.code, client: "web" }),
    });
    if (response.ok) {
      // Come back the way the other link flows do: a fresh page carrying
      // `link=apple`, which consumeLinkResult announces.
      const params = new URLSearchParams(window.location.hash.slice(1));
      params.set("link", "apple");
      history.replaceState(null, "", `#${params}`);
      window.location.reload();
      return true;
    }
    console.error("Apple link failed", response.status);
    const alreadyLinked =
      response.status === 409 &&
      (await reasonOf(response)) === "already_linked";
    void showInGameAlert(
      translateText(
        alreadyLinked
          ? "account_modal.link_apple_already_linked"
          : "account_modal.link_apple_error",
      ),
    );
  } catch (e) {
    console.warn("Apple link failed", e);
    void showInGameAlert(translateText("account_modal.link_apple_error"));
  }
  return true;
}
