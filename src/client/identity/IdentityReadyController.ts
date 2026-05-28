import type { ReactiveController, ReactiveControllerHost } from "lit";
import {
  getIdentityState,
  subscribeIdentity,
  type IdentityState,
} from "./IdentityStore";

// Subscribes a Lit host to the identity store and re-renders it whenever the
// ready state changes, so play buttons can bind `?disabled=${!identity.ready}`.
export class IdentityReadyController implements ReactiveController {
  private unsubscribe: (() => void) | null = null;
  private snapshot: IdentityState;

  constructor(private readonly host: ReactiveControllerHost) {
    this.host.addController(this);
    this.snapshot = getIdentityState();
  }

  hostConnected(): void {
    this.unsubscribe = subscribeIdentity((state) => {
      this.snapshot = state;
      this.host.requestUpdate();
    });
  }

  hostDisconnected(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  get ready(): boolean {
    return this.snapshot.ready;
  }

  get validating(): boolean {
    return this.snapshot.clanTagChecking;
  }

  get state(): IdentityState {
    return this.snapshot;
  }
}
