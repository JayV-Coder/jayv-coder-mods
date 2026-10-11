// node --test scripts/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCatalog, LOCALES, manifestProblems, serialize } from "./catalog.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const engines = { llm: ["claude"], feature: ["stats"], withdrawn: [] };
const texts = (text) => Object.fromEntries(LOCALES.map((locale) => [locale, text]));
const feature = (patch = {}) => ({ id: "stats", kind: "feature", category: "project", plan: "stats", defaultOn: true, minApp: "0.94.0", title: texts("Statistics"), summary: texts("Charts."), ...patch });
const template = (patch = {}) => ({
  id: "local-ai", kind: "template", category: "agents", plan: "customMods", minApp: "0.94.0", title: texts("Local AI"), summary: texts("Local models."),
  template: { kind: "api", protocol: "openai", baseUrl: "http://localhost:8080/v1", keyRequired: false, models: [] }, ...patch,
});

test("the published catalog is valid and up to date", () => {
  const { catalog, problems } = buildCatalog(root);
  assert.deepEqual(problems, []);
  assert.equal(readFileSync(join(root, "catalog.json"), "utf8"), serialize(catalog));
  assert.ok(catalog.mods.every((mod) => !("$schema" in mod)), "o catálogo não leva o $schema");
});

test("a valid feature and template pass", () => {
  assert.deepEqual(manifestProblems(feature(), "stats", engines), []);
  assert.deepEqual(manifestProblems(template(), "local-ai", engines), []);
});

test("the id is the folder and must name an engine of the app", () => {
  assert.ok(manifestProblems(feature(), "other", engines).some((problem) => problem.includes("folder name")));
  assert.ok(manifestProblems(feature({ id: "unknown" }), "unknown", engines).some((problem) => problem.includes("engines.json")));
  assert.ok(manifestProblems(template({ id: "stats" }), "stats", engines).some((problem) => problem.includes("engine of the app")));
});

test("every text comes in the ten locales", () => {
  const { de: _removed, ...nine } = texts("Statistics");
  assert.ok(manifestProblems(feature({ title: nine }), "stats", engines).some((problem) => problem.includes("title.de")));
  assert.ok(manifestProblems(feature({ summary: { ...texts("x"), xx: "y" } }), "stats", engines).some((problem) => problem.includes("not a locale")));
});

test("unknown fields and misplaced ones are refused", () => {
  assert.ok(manifestProblems(feature({ tittle: texts("x") }), "stats", engines).some((problem) => problem.includes("tittle")));
  assert.ok(manifestProblems(feature({ defaultOn: undefined }), "stats", engines).some((problem) => problem.includes("defaultOn")));
  assert.ok(manifestProblems({ ...template(), defaultOn: true }, "local-ai", engines).some((problem) => problem.includes("only a feature")));
});

test("a command-line template follows the rules of the app", () => {
  const cli = (patch) => template({ template: { kind: "cli", command: "local-ai", args: ["--model", "{model}", "{prompt}"], planArgs: [], edits: false, models: [], ...patch } });
  assert.deepEqual(manifestProblems(cli({}), "local-ai", engines), []);
  assert.ok(manifestProblems(cli({ args: ["{file}"] }), "local-ai", engines).some((problem) => problem.includes("{file}")));
  assert.ok(manifestProblems(cli({ edits: true }), "local-ai", engines).some((problem) => problem.includes("planArgs")));
  assert.ok(manifestProblems(cli({ command: "local ai" }), "local-ai", engines).some((problem) => problem.includes("without arguments")));
});

test("an engine without a mod needs to be withdrawn on purpose", () => {
  const dir = mkdtempSync(join(tmpdir(), "mods-"));
  writeFileSync(join(dir, "engines.json"), JSON.stringify({ llm: ["claude"], feature: ["stats"], withdrawn: [] }));
  mkdirSync(join(dir, "mods", "stats"), { recursive: true });
  writeFileSync(join(dir, "mods", "stats", "mod.json"), JSON.stringify(feature()));
  assert.ok(buildCatalog(dir).problems.some((problem) => problem.includes("engine claude")));
  writeFileSync(join(dir, "engines.json"), JSON.stringify({ llm: ["claude"], feature: ["stats"], withdrawn: ["claude"] }));
  const { catalog, problems } = buildCatalog(dir);
  assert.deepEqual(problems, []);
  assert.deepEqual(catalog.mods.map((mod) => mod.id), ["stats"]);
});
