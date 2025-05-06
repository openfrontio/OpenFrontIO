export interface Warning {
  message: string;
  createdAt: number;
  duration: number;
  id: number;
}

export class WarningManager {
  private static instance: WarningManager;
  private warnings: Warning[] = [];
  private nextId = 1;

  // Default duration in milliseconds
  private static DEFAULT_DURATION = 5000;

  private constructor() {}

  public static getInstance(): WarningManager {
    if (!WarningManager.instance) {
      WarningManager.instance = new WarningManager();
    }
    return WarningManager.instance;
  }

  /**
   * Add a new warning message
   * @param message The warning message
   * @param duration Duration in milliseconds the warning should be visible (default: 5000ms)
   * @returns The created warning object
   */
  public addWarning(
    message: string,
    duration: number = WarningManager.DEFAULT_DURATION,
  ): Warning {
    const warning: Warning = {
      message,
      createdAt: Date.now(),
      duration,
      id: this.nextId++,
    };

    this.warnings.push(warning);

    // Clean up
    setTimeout(() => {
      this.removeWarning(warning.id);
    }, duration);

    return warning;
  }

  /**
   * Remove a warning by ID
   * @param id The warning ID to remove
   */
  public removeWarning(id: number): void {
    this.warnings = this.warnings.filter((w) => w.id !== id);
  }

  /**
   * Get all active warnings
   */
  public getWarnings(): Warning[] {
    return [...this.warnings];
  }

  /**
   * Clear all warnings
   */
  public clearAll(): void {
    this.warnings = [];
  }
}

/**
 * global function to add a warning message
 * @param message The warning message
 * @param duration Optional duration in milliseconds (default: 5000ms)
 */
export function WARNING(message: string, duration?: number): void {
  WarningManager.getInstance().addWarning(message, duration);
}
