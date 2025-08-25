type TimedTask = {
  delay: number;
  action: () => void;
  triggered: boolean;
};

/**
 * Basic timeline to chain actions
 */
export class Timeline {
  private readonly tasks: TimedTask[] = [];
  private timeElapsed = 0;

  add(delay: number, action: () => void): Timeline {
    this.tasks.push({ action, delay, triggered: false });
    return this;
  }

  update(dt: number) {
    this.timeElapsed += dt;

    for (const task of this.tasks) {
      if (!task.triggered && this.timeElapsed >= task.delay) {
        task.action();
        task.triggered = true;
      }
    }
  }

  isComplete() {
    return this.tasks.every((t) => t.triggered);
  }
}
