import { GameEvent } from "../../core/EventBus";

export class TimelineSeekEvent implements GameEvent {
  constructor(public readonly targetTick: number) {}
}

export class TimelineGoLiveEvent implements GameEvent {}

export class TimelineModeChangedEvent implements GameEvent {
  constructor(public readonly isLive: boolean) {}
}

export class TimelineJumpEvent implements GameEvent {
  constructor(
    public readonly fromTick: number,
    public readonly toTick: number,
  ) {}
}

export class TimelineRangeEvent implements GameEvent {
  constructor(
    public readonly liveTick: number,
    public readonly displayTick: number,
    public readonly isLive: boolean,
    public readonly isSeeking: boolean,
    public readonly storageError: string | null,
  ) {}
}

export class TimelineRangeRequestEvent implements GameEvent {}
