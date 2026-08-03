export type WatchHealthState = "starting" | "healthy" | "degraded" | "failed";
export type WatchFailurePhase = "startup" | "runtime" | "indexing";
export type WatchFailureCode = "ENOSPC" | "EMFILE" | "EACCES" | "INDEX_ERROR" | "UNKNOWN";

export interface WatchHealthError {
  code: WatchFailureCode;
  originalCode?: string;
  phase: WatchFailurePhase;
  message: string;
  occurredAt: string;
  fatal: boolean;
}

export interface WatchHealthSnapshot {
  state: WatchHealthState;
  startedAt: string;
  updatedAt: string;
  lastSuccessfulIndexAt?: string;
  lastError?: WatchHealthError;
  consecutiveIndexFailures: number;
  coverageReliable: boolean;
  polling: boolean;
  closed: boolean;
}

export class WatchHealthTracker {
  private snapshotValue: WatchHealthSnapshot;

  constructor(
    polling = false,
    private readonly onChanged?: (health: WatchHealthSnapshot) => void,
    startedAt = new Date().toISOString()
  ) {
    this.snapshotValue = {
      state: "starting",
      startedAt,
      updatedAt: startedAt,
      consecutiveIndexFailures: 0,
      coverageReliable: true,
      polling,
      closed: false
    };
  }

  snapshot(): WatchHealthSnapshot {
    return structuredClone(this.snapshotValue);
  }

  recordReady(at = new Date().toISOString()): void {
    this.update({ state: "healthy", updatedAt: at });
  }

  recordIndexSuccess(at = new Date().toISOString()): void {
    this.update({
      state: this.snapshotValue.coverageReliable ? "healthy" : "degraded",
      updatedAt: at,
      lastSuccessfulIndexAt: at,
      consecutiveIndexFailures: 0
    });
  }

  recordError(error: unknown, phase: WatchFailurePhase, at = new Date().toISOString()): WatchHealthError {
    const normalized = normalizeWatchError(error, phase, at);
    const coverageReliable = phase === "runtime" ? false : this.snapshotValue.coverageReliable;
    this.update({
      state: normalized.fatal ? "failed" : "degraded",
      updatedAt: at,
      lastError: normalized,
      coverageReliable,
      consecutiveIndexFailures: phase === "indexing" ? this.snapshotValue.consecutiveIndexFailures + 1 : this.snapshotValue.consecutiveIndexFailures
    });
    return normalized;
  }

  close(at = new Date().toISOString()): void {
    this.update({ updatedAt: at, closed: true });
  }

  private update(changes: Partial<WatchHealthSnapshot>): void {
    this.snapshotValue = { ...this.snapshotValue, ...changes };
    try {
      this.onChanged?.(this.snapshot());
    } catch {
      // Health observers must not break watcher cleanup or indexing.
    }
  }
}

export function normalizeWatchError(
  error: unknown,
  phase: WatchFailurePhase,
  occurredAt = new Date().toISOString()
): WatchHealthError {
  const message = error instanceof Error ? error.message : String(error);
  const rawCode = errorCode(error);
  const code: WatchFailureCode = phase === "indexing"
    ? "INDEX_ERROR"
    : rawCode === "ENOSPC" || rawCode === "EMFILE" || rawCode === "EACCES" ? rawCode : "UNKNOWN";
  return {
    code,
    originalCode: phase === "indexing" && rawCode ? rawCode : undefined,
    phase,
    message,
    occurredAt,
    fatal: phase === "startup"
  };
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" && error.code ? error.code : undefined;
}
