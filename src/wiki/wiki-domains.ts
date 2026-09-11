import type { GraphDocument } from "../types.js";

/** Project-neutral starting points; page evidence supplies the actual project vocabulary. */
export interface WikiDomain {
  id: string;
  title: string;
  path: string;
  purpose: string;
  audience: string;
  outline: string[];
  evidenceQueries: string[];
  score(document: GraphDocument): number;
}

const words = (document: GraphDocument, values: string[]) => {
  const text = `${document.title} ${document.path}`.toLowerCase();
  return values.reduce((score, word) => score + (text.includes(word) ? 3 : 0), 0);
};
const basename = (document: GraphDocument, names: string[]) => names.includes(document.path.split("/").at(-1)!.toLowerCase()) ? 12 : 0;

export const WIKI_DOMAINS: WikiDomain[] = [
  {
    id: "project-overview", title: "Project Overview", path: "index.md",
    purpose: "Explain what this project does, who it serves, how to start, and where to find the next useful instructions.",
    audience: "New users and contributors evaluating or starting with the project.",
    outline: ["Purpose and audience", "Core concepts", "Getting started", "First successful task", "Next steps"],
    evidenceQueries: ["project purpose getting started"],
    score: (document) => basename(document, ["readme.md", "readme-zh.md"]) + words(document, ["overview", "introduction", "quickstart", "概览", "快速开始"])
  },
  {
    id: "architecture", title: "Architecture", path: "architecture.md",
    purpose: "Explain implemented components, their responsibilities, data flow, and the decisions behind their boundaries.",
    audience: "Contributors changing behavior across components.",
    outline: ["System boundary", "Components", "Data flow", "Decisions", "Extension points"],
    evidenceQueries: ["architecture components decisions"],
    score: (document) => (document.type === "adr" ? 8 : document.type === "design" ? 5 : 0) + words(document, ["architecture", "design", "decision", "架构", "设计", "决策"])
  },
  {
    id: "core-workflows", title: "Core Workflows", path: "core-workflows.md",
    purpose: "Describe the project's main user tasks, their prerequisites, successful outcomes, and recovery steps.",
    audience: "Users applying the project to real tasks.",
    outline: ["Main tasks", "Prerequisites", "Steps and outcomes", "Failure recovery", "Related tasks"],
    evidenceQueries: ["usage workflow tasks"],
    score: (document) => (document.type === "spec" ? 2 : 0) + words(document, ["workflow", "usage", "tutorial", "guide", "工作流", "使用", "教程"])
  },
  {
    id: "development", title: "Development Guide", path: "development.md",
    purpose: "Explain contributor setup, repository conventions, checks, and the change workflow.",
    audience: "Contributors implementing and reviewing changes.",
    outline: ["Setup", "Conventions", "Build and test", "Change workflow", "Review"],
    evidenceQueries: ["development contribution build test"],
    score: (document) => basename(document, ["agents.md", "contributing.md"]) + words(document, ["development", "contributing", "testing", "开发", "贡献", "测试"])
  },
  {
    id: "operations", title: "Operations and Troubleshooting", path: "operations.md",
    purpose: "Explain how to run the project, inspect failures, and recover normal operation.",
    audience: "Users and maintainers operating or troubleshooting the project.",
    outline: ["Running the project", "Diagnostics", "Common failures", "Recovery", "Maintenance"],
    evidenceQueries: ["operations troubleshooting recovery"],
    score: (document) => (document.type === "runbook" || document.type === "incident" ? 8 : 0) + words(document, ["operations", "runbook", "incident", "troubleshoot", "运维", "排障", "故障"])
  },
  {
    id: "reference", title: "Reference", path: "reference.md",
    purpose: "Locate exact public interfaces, configuration, compatibility requirements, and input/output contracts.",
    audience: "Users and integrators needing precise interface details.",
    outline: ["Public interfaces", "Configuration", "Inputs and outputs", "Compatibility", "Examples"],
    evidenceQueries: ["reference interfaces configuration contracts"],
    score: (document) => (document.type === "api" ? 7 : 0) + words(document, ["reference", "contract", "configuration", "参考", "契约", "配置"])
  }
];
