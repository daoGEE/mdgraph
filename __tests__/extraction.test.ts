import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config/load-config.js";
import { extractEntities } from "../src/extraction/entity-extractor.js";
import { parseMarkdownDocument } from "../src/parser/markdown-parser.js";

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("extractEntities", () => {
  it("extracts high-confidence entities without promoting generic prose symbols", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-extraction-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    const file = path.join(docsDir, "auth.md");
    fs.writeFileSync(file, [
      "---",
      "title: Auth Design",
      "defines: [AuthService]",
      "---",
      "# Auth Design",
      "",
      "Service appears as ordinary prose and should not become a strong entity.",
      "",
      "## Defines",
      "",
      "- `RedisTimeoutError`: timeout from Redis.",
      "",
      "## Runtime",
      "",
      "The route `GET /api/auth/login` calls `AuthService` and handles `RedisTimeoutError`.",
      "Set `JWT_SECRET` and check `src/auth/session.ts`.",
      ""
    ].join("\n"), "utf8");

    const parsed = parseMarkdownDocument(root, file);
    const entities = extractEntities(parsed, DEFAULT_CONFIG);
    const labels = entities.map((entity) => `${entity.role}:${entity.kind}:${entity.name}`);

    expect(labels).toContain("definition:symbol:AuthService");
    expect(labels).toContain("definition:error_code:RedisTimeoutError");
    expect(labels).toContain("reference:api_route:GET /api/auth/login");
    expect(labels).toContain("reference:config_key:JWT_SECRET");
    expect(labels).toContain("reference:file_path:src/auth/session.ts");
    expect(labels).not.toContain("reference:symbol:Service");
  });

  it("filters configured stop entities and broad prose PascalCase from ordinary text", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-extraction-stop-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    const file = path.join(docsDir, "noise.md");
    fs.writeFileSync(file, [
      "# Noise",
      "",
      "Config Error Service API User Data appear as ordinary prose.",
      "The ParserThing and AuthCoordinator words are prose-only and should stay in FTS, not graph references.",
      "Inline code still references `AuthCoordinator` when written as code.",
      ""
    ].join("\n"), "utf8");

    const parsed = parseMarkdownDocument(root, file);
    const entities = extractEntities(parsed, DEFAULT_CONFIG);
    const labels = entities.map((entity) => `${entity.role}:${entity.kind}:${entity.name}`);

    for (const stopEntity of DEFAULT_CONFIG.entities.stopEntities) {
      expect(labels).not.toContain(`reference:symbol:${stopEntity}`);
    }
    expect(labels).not.toContain("reference:symbol:ParserThing");
    expect(labels).toContain("reference:symbol:AuthCoordinator");
  });

  it("extracts CJK routes, config keys, functions, and explicit symbols", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-extraction-cjk-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    const file = path.join(docsDir, "cjk.md");
    fs.writeFileSync(file, [
      "# 多语言运行信号",
      "",
      "路由 POST /接口/登录 使用配置 登录.认证.重试 和 HTTP2，但 M9 是里程碑标签。",
      "显式代码引用 `登录服务`、`验证登录()` 和 `認証を確認()`。",
      "文件 `src/auth/session.ts` 不应产生截断路由。",
      "",
      "```ts",
      "Do Prefer ParserThing FactoryThing",
      "class SessionRepository {}",
      "interface AuthAdapter {}",
      "function 验证会话() {}",
      "```",
      ""
    ].join("\n"), "utf8");

    const entities = extractEntities(parseMarkdownDocument(root, file), DEFAULT_CONFIG);
    const labels = entities.map((entity) => `${entity.kind}:${entity.name}`);

    expect(labels).toEqual(expect.arrayContaining([
      "api_route:POST /接口/登录",
      "config_key:登录.认证.重试",
      "config_key:HTTP2",
      "symbol:登录服务",
      "symbol:验证登录()",
      "symbol:認証を確認()",
      "symbol:验证会话()",
      "symbol:SessionRepository",
      "symbol:AuthAdapter",
      "file_path:src/auth/session.ts"
    ]));
    expect(labels).not.toContain("api_route:/auth/session.ts");
    expect(labels).not.toContain("symbol:Do");
    expect(labels).not.toContain("symbol:M9");
    expect(labels).not.toContain("config_key:M9");
    expect(labels).not.toContain("symbol:ParserThing");
    expect(labels).not.toContain("symbol:FactoryThing");
  });

  it("applies configured stop entities to every inferred reference kind but preserves explicit definitions", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-extraction-stop-kinds-"));
    tempDirs.push(root);
    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    const file = path.join(docsDir, "stop-kinds.md");
    fs.writeFileSync(file, [
      "---",
      "defines: [JWT_SECRET]",
      "---",
      "# Runtime",
      "",
      "Use `JWT_SECRET`, `GET /api/auth/login`, and `验证登录()`.",
      ""
    ].join("\n"), "utf8");
    const config = {
      ...DEFAULT_CONFIG,
      entities: {
        ...DEFAULT_CONFIG.entities,
        stopEntities: [
          ...DEFAULT_CONFIG.entities.stopEntities,
          "JWT_SECRET",
          "GET /api/auth/login",
          "验证登录()"
        ]
      }
    };

    const entities = extractEntities(parseMarkdownDocument(root, file), config);
    const labels = entities.map((entity) => `${entity.role}:${entity.kind}:${entity.name}`);

    expect(labels).toContain("definition:config_key:JWT_SECRET");
    expect(labels).not.toContain("reference:config_key:JWT_SECRET");
    expect(labels).not.toContain("reference:api_route:GET /api/auth/login");
    expect(labels).not.toContain("reference:symbol:验证登录()");
  });
});
