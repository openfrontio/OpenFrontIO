import type { ReactiveController, ReactiveControllerHost } from "lit";
import {
  awaitIdentityReady,
  getIdentityState,
  subscribeIdentity,
  type IdentityState,
} from "./IdentityStore";

// Subscribes a Lit host to the identity store and triggers a re-render
// whenever the ready/validating state changes. Lets play buttons bind
// `?disabled=${!identity.ready}` without bespoke wiring per consumer.
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

  async awaitReady(): Promise<boolean> {
    return awaitIdentityReady();
  }
}
