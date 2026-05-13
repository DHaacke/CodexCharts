# How To Install And Use The CodexCharts Skill Pack

This guide explains how to reuse this project's skills in a new or existing Node/Express TypeScript app, including BHRA-Importer.

## 1. Where to keep the skill files

- Keep `skills.md` at project root.
- Keep this file (`skills-instructions.md`) at project root.
- Keep migration checklist (`migrate.md`) at project root when planning cross-project work.

## 2. Setup in a new Node + Express + TypeScript project

1. Initialize project:

```sh
mkdir my-app && cd my-app
npm init -y
```

2. Install baseline dependencies:

```sh
npm install express ejs mysql2 chart.js axios openai dotenv ajv
npm install -D typescript ts-node @types/node @types/express
```

3. Initialize TypeScript:

```sh
npx tsc --init
```

4. Copy `skills.md` and `skills-instructions.md` into project root.

5. Add `.env` and store secrets there (never commit real keys).

## 3. Setup in an existing project

1. Add missing packages from the dependency list above.
2. Copy or merge `skills.md` into root.
3. Review `migrate.md` and create a feature-by-feature migration plan.
4. Align existing routes and data flow with the contract-first approach.

## 4. Recommended implementation order

1. Add/confirm JSON Schema contract.
2. Add/confirm validator and request builder.
3. Implement stored-procedure data fetch path.
4. Implement chart config builder and HTML rendering.
5. Add UI action flow that triggers exports/charts.
6. Add examples and run-through tests.

## 5. Rules to keep behavior consistent

- Default output should remain HTML.
- Keep SVG/PDF support as future-ready, not default runtime behavior.
- Do not hardcode schema allow-lists for procedure names unless required.
- Keep request parsing and validation deterministic with clear errors.

## 6. OpenAI usage rules

- Use environment variables for API credentials.
- Do not include any real API key in docs, source, or prompt files.
- Validate all generated request payloads against schema before execution.

## 7. Applying this directly to BHRA-Importer

1. Identify the export-only surface area first.
2. Port contract, validator, request builder, and renderer as isolated modules.
3. Wire BHRA categorized table selections to those modules.
4. Verify each export category end-to-end before adding new output types.

## 8. Operational checks before each release

1. Build passes.
2. Stored procedure calls return expected result set.
3. Chart HTML output renders correctly.
4. Errors are user-readable for bad input and empty result sets.
5. Skill docs and examples are updated to match current behavior.
