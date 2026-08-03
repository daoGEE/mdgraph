import chokidar, { type FSWatcher } from "chokidar";
import type { Stats } from "node:fs";
import path from "node:path";
import { loadConfig } from "../config/load-config.js";
import { indexProject, type IndexResult } from "../indexer.js";
import { resolveIgnorePatterns } from "../scanner/file-scanner.js";
import { WatchHealthTracker, type WatchHealthSnapshot } from "./watch-health.js";

export interface WatchProjectOptions {
  debounceMs?: number;
  semantic?: boolean;
  usePolling?: boolean;
  onIndexed?: (result: IndexResult) => void;
  onError?: (error: Error) => void;
  onHealthChanged?: (health: WatchHealthSnapshot) => void;
}

export interface WatchHandle {
  close: () => Promise<void>;
  getHealth: () => WatchHealthSnapshot;
}

export async function watchProject(projectRoot: string, options: WatchProjectOptions = {}): Promise<WatchHandle> {
  const health = new WatchHealthTracker(options.usePolling ?? false, options.onHealthChanged);
  let config: ReturnType<typeof loadConfig>;
  let ignored: Awaited<ReturnType<typeof resolveIgnorePatterns>>;
  try {
    config = loadConfig(projectRoot);
    ignored = await resolveIgnorePatterns(projectRoot, config);
  } catch (error) {
    health.recordError(error, "startup");
    notifyError(options.onError, error);
    health.close();
    throw error;
  }
  const watchesMdx = config.index.parseMdx;
  const debounceMs = options.debounceMs ?? 250;
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let queued = false;
  let closed = false;
  let ready = false;
  let activeIndex: Promise<void> | undefined;

  const runIndex = async (): Promise<void> => {
    if (closed) {
      return;
    }
    if (running) {
      queued = true;
      await activeIndex;
      return;
    }
    running = true;
    activeIndex = (async () => {
      try {
        const result = await indexProject(projectRoot, { semantic: options.semantic });
        health.recordIndexSuccess();
        notifyIndexed(options.onIndexed, result);
      } catch (error) {
        health.recordError(error, "indexing");
        notifyError(options.onError, error);
      } finally {
        running = false;
        activeIndex = undefined;
        if (!closed && queued) {
          queued = false;
          scheduleIndex();
        }
      }
    })();
    await activeIndex;
  };

  const scheduleIndex = (): void => {
    if (closed) {
      return;
    }
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      void runIndex();
    }, debounceMs);
  };

  const scheduleIndexForMarkdown = (filePath: string): void => {
    const lower = filePath.toLowerCase();
    if (lower.endsWith(".md") || (watchesMdx && lower.endsWith(".mdx"))) {
      scheduleIndex();
    }
  };

  let watcher: FSWatcher;
  try {
    watcher = chokidar.watch(".", {
      cwd: projectRoot,
      ignored: createWatchIgnoreMatcher(projectRoot, ignored, watchesMdx),
      ignoreInitial: true,
      persistent: true,
      usePolling: options.usePolling ?? false,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 }
    });
  } catch (error) {
    health.recordError(error, "startup");
    notifyError(options.onError, error);
    health.close();
    throw error;
  }

  watcher.on("add", scheduleIndexForMarkdown);
  watcher.on("change", scheduleIndexForMarkdown);
  watcher.on("unlink", scheduleIndexForMarkdown);
  watcher.on("error", (error) => {
    if (!ready) {
      return;
    }
    health.recordError(error, "runtime");
    notifyError(options.onError, error);
  });

  try {
    await waitForReady(watcher);
    ready = true;
    health.recordReady();
    await runIndex();
  } catch (error) {
    closed = true;
    health.recordError(error, "startup");
    notifyError(options.onError, error);
    await watcher.close();
    health.close();
    throw error;
  }

  return {
    getHealth: () => health.snapshot(),
    close: async () => {
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      try {
        if (activeIndex) {
          await activeIndex;
        }
      } finally {
        await watcher.close();
        health.close();
      }
    }
  };
}

function createWatchIgnoreMatcher(projectRoot: string, patterns: readonly string[], watchesMdx: boolean): (candidatePath: string, stats?: Stats) => boolean {
  const root = path.resolve(projectRoot);
  return (candidatePath, stats) => {
    const absolutePath = path.isAbsolute(candidatePath) ? candidatePath : path.resolve(root, candidatePath);
    const relativePath = path.relative(root, absolutePath);
    if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
      return false;
    }

    const normalizedPath = relativePath.split(path.sep).join("/");
    if (patterns.some((pattern) => (
      path.matchesGlob(normalizedPath, pattern)
      || path.matchesGlob(`${normalizedPath}/`, pattern)
    ))) {
      return true;
    }

    if (stats && !stats.isDirectory()) {
      return !normalizedPath.toLowerCase().endsWith(".md")
        && !(watchesMdx && normalizedPath.toLowerCase().endsWith(".mdx"));
    }
    return false;
  };
}

function notifyIndexed(onIndexed: WatchProjectOptions["onIndexed"], result: IndexResult): void {
  try {
    onIndexed?.(result);
  } catch {
    // User callbacks must not break watcher cleanup or future indexing.
  }
}

function notifyError(onError: WatchProjectOptions["onError"], error: unknown): void {
  try {
    onError?.(error instanceof Error ? error : new Error(String(error)));
  } catch {
    // User callbacks must not break watcher cleanup or future indexing.
  }
}

function waitForReady(watcher: FSWatcher): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      watcher.off("ready", onReady);
      watcher.off("error", onError);
    };
    const onReady = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: unknown): void => {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    watcher.once("ready", onReady);
    watcher.once("error", onError);
  });
}
