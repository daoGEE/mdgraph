# Security Policy

## Supported Versions

Security fixes are applied to the latest released version. Maintainers may ask reporters to verify a finding against `main` when the relevant code has changed since the release.

## Reporting a Vulnerability

Please do not open a public issue with exploit details, secrets, private documents, or sensitive paths.

Use GitHub's private vulnerability reporting for [daoGEE/mdgraph](https://github.com/daoGEE/mdgraph/security/advisories/new). Include:

- A concise description and expected impact.
- The affected MDGraph version and operating system.
- Minimal reproduction steps using sanitized test data.
- Whether the issue crosses a project-root boundary, exposes local content, executes untrusted input, or causes resource exhaustion.

If private vulnerability reporting is unavailable, open a public issue that asks the maintainer for a private contact channel without including vulnerability details.

You should receive an acknowledgement within seven days. Disclosure timing will be coordinated after the issue is reproduced and a fix path is known.

## Scope

MDGraph processes local Markdown and exposes results to local CLI or MCP clients. Reports involving path containment, SQLite artifacts, MCP input boundaries, Markdown content risks, and accidental publication of local data are especially relevant. Prompt injection contained in indexed documents is treated as untrusted content that should be surfaced to the agent, not executed as an instruction.
