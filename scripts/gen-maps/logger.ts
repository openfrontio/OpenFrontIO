// slog-style levels plus the opt-in performance/removal tags.

export const LEVEL_ALL = -8;
export const LEVEL_DEBUG = -4;
export const LEVEL_INFO = 0;
export const LEVEL_WARN = 4;
export const LEVEL_ERROR = 8;

export const PERF = "performance";
export const REMOVAL = "removal";
export type LogTag = typeof PERF | typeof REMOVAL;

export interface LogFlags {
  logLevel: string;
  verbose: boolean;
  performance: boolean;
  removal: boolean;
}

export function determineLogLevel(f: LogFlags): number {
  let level = LEVEL_INFO;
  if (f.verbose || f.performance || f.removal) level = LEVEL_DEBUG;
  if (f.logLevel !== "") {
    const levels: Record<string, number> = {
      all: LEVEL_ALL,
      debug: LEVEL_DEBUG,
      info: LEVEL_INFO,
      warn: LEVEL_WARN,
      error: LEVEL_ERROR,
    };
    const key = f.logLevel.toLowerCase();
    // Own keys only: --log-level=constructor must fall back to info.
    const parsed = Object.prototype.hasOwnProperty.call(levels, key)
      ? levels[key]
      : undefined;
    if (parsed === undefined) {
      process.stdout.write(
        `invalid log level: ${f.logLevel}, defaulting to info\n`,
      );
      level = LEVEL_INFO;
    } else {
      level = parsed;
    }
  }
  return level;
}

export class Logger {
  private readonly level: number;
  private readonly flags: LogFlags;
  private readonly mapName: string;
  private readonly isTest: boolean;
  constructor(level: number, flags: LogFlags, mapName = "", isTest = false) {
    this.level = level;
    this.flags = flags;
    this.mapName = mapName;
    this.isTest = isTest;
  }

  withMap(name: string, isTest: boolean): Logger {
    return new Logger(this.level, this.flags, name, isTest);
  }

  debug(msg: string, tag?: LogTag): void {
    this.log(LEVEL_DEBUG, msg, tag);
  }
  info(msg: string, tag?: LogTag): void {
    this.log(LEVEL_INFO, msg, tag);
  }
  warn(msg: string, tag?: LogTag): void {
    this.log(LEVEL_WARN, msg, tag);
  }

  private log(level: number, msg: string, tag?: LogTag): void {
    if (level < this.level) return;
    if (this.level !== LEVEL_ALL && tag === PERF && !this.flags.performance)
      return;
    if (this.level !== LEVEL_ALL && tag === REMOVAL && !this.flags.removal)
      return;
    if (tag === PERF && this.isTest) return;
    let line = "";
    if (
      (this.level === LEVEL_DEBUG || this.level === LEVEL_ALL) &&
      this.mapName !== ""
    ) {
      line += `[${this.mapName}] `;
    }
    if (tag === PERF) line += "[PERF] ";
    process.stdout.write(line + msg + "\n");
  }
}
