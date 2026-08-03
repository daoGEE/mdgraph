import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const markdownFiles = [
  "README.md",
  "README-ZH.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "AGENTS.md",
  ...listMarkdownFiles(".github"),
  ...listMarkdownFiles("agent-pack"),
  ...listMarkdownFiles("docs/EN"),
  ...listMarkdownFiles("docs/ZH")
].sort();
const headingsByFile = new Map();
const errors = [];

for (const relativeFile of markdownFiles) {
  const absoluteFile = path.join(repoRoot, relativeFile);
  const markdown = fs.readFileSync(absoluteFile, "utf8");
  for (const match of markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)) {
    const rawTarget = match[1].trim().replace(/^<|>$/gu, "");
    if (/^(?:https?:|mailto:)/iu.test(rawTarget)) {
      continue;
    }

    const hashIndex = rawTarget.indexOf("#");
    const encodedPath = hashIndex >= 0 ? rawTarget.slice(0, hashIndex) : rawTarget;
    const encodedAnchor = hashIndex >= 0 ? rawTarget.slice(hashIndex + 1) : "";
    let decodedPath;
    let decodedAnchor;
    try {
      decodedPath = decodeURIComponent(encodedPath);
      decodedAnchor = decodeURIComponent(encodedAnchor).toLowerCase();
    } catch {
      errors.push(`${relativeFile}: invalid percent-encoding in link ${rawTarget}`);
      continue;
    }

    const targetFile = decodedPath.length > 0
      ? decodedPath.startsWith("/")
        ? path.resolve(repoRoot, decodedPath.slice(1))
        : path.resolve(path.dirname(absoluteFile), decodedPath)
      : absoluteFile;
    if (!isInsideRepository(targetFile) || !fs.existsSync(targetFile)) {
      errors.push(`${relativeFile}: missing relative link target ${rawTarget}`);
      continue;
    }

    if (decodedAnchor && path.extname(targetFile).toLowerCase() === ".md") {
      const headings = getHeadingSlugs(targetFile);
      if (!headings.has(decodedAnchor)) {
        errors.push(`${relativeFile}: missing Markdown heading #${decodedAnchor} in ${path.relative(repoRoot, targetFile)}`);
      }
    }
  }
}

if (errors.length > 0) {
  throw new Error(`Public documentation check failed:\n${errors.join("\n")}`);
}

console.log(`Checked ${markdownFiles.length} public Markdown files and their relative links.`);

function listMarkdownFiles(relativeDirectory) {
  const absoluteDirectory = path.join(repoRoot, relativeDirectory);
  const files = [];
  for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(relativePath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(relativePath);
    }
  }
  return files;
}

function isInsideRepository(targetPath) {
  const relativePath = path.relative(repoRoot, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function getHeadingSlugs(absoluteFile) {
  const cached = headingsByFile.get(absoluteFile);
  if (cached) {
    return cached;
  }

  const slugs = new Set();
  const counts = new Map();
  const markdown = fs.readFileSync(absoluteFile, "utf8");
  for (const line of markdown.split(/\r?\n/gu)) {
    const match = /^(?: {0,3})#{1,6}\s+(.+?)\s*#*\s*$/u.exec(line);
    if (!match) {
      continue;
    }
    const base = githubHeadingSlug(match[1]);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    slugs.add(count === 0 ? base : `${base}-${count}`);
  }
  headingsByFile.set(absoluteFile, slugs);
  return slugs;
}

function githubHeadingSlug(heading) {
  return heading
    .toLowerCase()
    .replace(/<[^>]*>/gu, "")
    .replace(/[`*_~]/gu, "")
    .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s+/gu, "-");
}
