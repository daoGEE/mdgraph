import type { GraphRepository } from "../db/repositories.js";
import type { StatusFreshness } from "../analysis/status-freshness.js";
import { calculateWikiPageEvidenceHash, sourceRefFingerprint, type WikiEvidencePage } from "./wiki-evidence.js";
import type { WikiDependencySnapshot } from "./wiki-plan.js";

export interface WikiDependencyChange {
  kind: "document" | "source_ref" | "plan";
  path: string;
  reason: "modified" | "deleted" | "unavailable" | "plan_changed";
}

export interface WikiDependencyAssessment {
  state: "fresh" | "stale" | "unknown";
  currentEvidenceHash: string;
  changes: WikiDependencyChange[];
  recovery?: string;
}

/** Compare only a page's selected dependencies, retaining global index status separately. */
export function assessWikiDependencies(
  projectRoot: string,
  repository: GraphRepository,
  page: WikiEvidencePage & { evidenceHash: string; dependencySnapshot?: WikiDependencySnapshot },
  freshness: StatusFreshness,
  wikiDir?: string
): WikiDependencyAssessment {
  const changes: WikiDependencyChange[] = [];
  const documents = new Map(repository.allDocuments().map((document) => [document.id, document]));
  const savedDocuments = new Map(page.dependencySnapshot?.documents.map((document) => [document.id, document]) ?? []);
  const diskChanges = new Map(freshness.issues?.map((issue) => [issue.path, issue.reason]) ?? []);
  const isWikiOutput = (value: string) => Boolean(wikiDir && (value === wikiDir || value.startsWith(`${wikiDir}/`)));
  for (const id of page.documentIds) {
    const current = documents.get(id);
    const saved = savedDocuments.get(id);
    const documentPath = current?.path ?? saved?.path ?? id;
    const diskChange = diskChanges.get(documentPath);
    if (isWikiOutput(documentPath)) changes.push({ kind: "document", path: documentPath, reason: "unavailable" });
    else if (!current || diskChange === "deleted") changes.push({ kind: "document", path: documentPath, reason: "deleted" });
    else if (diskChange === "modified" || (saved && saved.hash !== current.hash)) changes.push({ kind: "document", path: documentPath, reason: "modified" });
  }
  const savedRefs = new Map(page.dependencySnapshot?.sourceRefs.map((ref) => [ref.path, ref.fingerprint]) ?? []);
  for (const sourcePath of page.sourceRefs) {
    const fingerprint = sourceRefFingerprint(projectRoot, sourcePath);
    if (isWikiOutput(sourcePath)) changes.push({ kind: "source_ref", path: sourcePath, reason: "unavailable" });
    else if (fingerprint === "missing") changes.push({ kind: "source_ref", path: sourcePath, reason: "deleted" });
    else if (!/^[a-f0-9]{64}$/.test(fingerprint)) changes.push({ kind: "source_ref", path: sourcePath, reason: "unavailable" });
    else if (savedRefs.has(sourcePath) && savedRefs.get(sourcePath) !== fingerprint) changes.push({ kind: "source_ref", path: sourcePath, reason: "modified" });
  }
  const currentEvidenceHash = calculateWikiPageEvidenceHash(projectRoot, repository, page);
  if (!changes.length && currentEvidenceHash !== page.evidenceHash) changes.push({ kind: "plan", path: page.path, reason: "plan_changed" });
  changes.sort((a, b) => a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path) || a.reason.localeCompare(b.reason));
  const state = freshness.state === "unknown" || changes.some((change) => change.reason === "unavailable")
    ? "unknown" : changes.length ? "stale" : "fresh";
  return {
    state, currentEvidenceHash, changes,
    recovery: state === "fresh" ? undefined : state === "unknown"
      ? "Inspect unavailable sources and run `mdgraph doctor --json`; refresh the index and plan before accepting page evidence."
      : "Run `mdgraph index`, update the plan with `wiki plan --from <plan> --out <next-plan>`, review the changes, then update this page from its new brief."
  };
}
