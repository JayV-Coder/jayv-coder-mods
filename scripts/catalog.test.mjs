// node --test scripts/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { agentIdOf, buildCatalog, legacyEntry, LOCALES, manifestProblems, outputs, POINTS } from "./catalog.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const engines = { llm: ["claude"], feature: ["stats", "mcp"], withdrawn: [] };
const texts = (text) => Object.fromEntries(LOCALES.map((locale) => [locale, text]));
const base = (id, contributes, patch = {}) => ({ id, version: "1.0.0", category: "project", plan: null, minApp: "0.94.0", title: texts(id), summary: texts(`${id}.`), contributes, ...patch });
const stats = (patch = {}) => base("stats", { features: ["stats"] }, { plan: "stats", preinstalled: true, ...patch });
const api = { kind: "api", protocol: "openai", baseUrl: "http://localhost:8080/v1", keyRequired: false, models: [] };
const localAi = (patch = {}) => base("local-ai", { agents: [api] }, { category: "agents", plan: "customMods", ...patch });

/** Uma pasta de mods de mentira, com `engines.json` e um `mod.json` por mod. */
function folder(mods, withEngines = engines) {
  const dir = mkdtempSync(join(tmpdir(), "mods-"));
  writeFileSync(join(dir, "engines.json"), JSON.stringify(withEngines));
  for (const mod of mods) {
    mkdirSync(join(dir, "mods", mod.id), { recursive: true });
    writeFileSync(join(dir, "mods", mod.id, "mod.json"), JSON.stringify(mod));
  }
  return dir;
}
const essentials = () => [base("claude", { llmEngines: ["claude"] }, { preinstalled: true }), stats(), base("mcp", { features: ["mcp"] }, { preinstalled: true })];

test("the published catalogs are valid and up to date", () => {
  const built = buildCatalog(root);
  assert.deepEqual(built.problems, []);
  for (const [name, text] of outputs(built)) assert.equal(readFileSync(join(root, name), "utf8"), text, `${name} em dia`);
  assert.ok(built.catalog.mods.every((mod) => !("$schema" in mod)), "o catálogo não leva o $schema");
  assert.equal(built.catalog.schema, 2);
  assert.equal(built.legacy.schema, 1);
});

/** Os mods de hoje se instalam sozinhos, no login de quem os vê. Os recursos
 * do app são essenciais; os motores de LLM e os agentes, não (regra do dono). */
test("the mods of today are preinstalled, the features required, and readable by the old app", () => {
  const { catalog, legacy } = buildCatalog(root);
  assert.ok(catalog.mods.every((mod) => mod.preinstalled === true));
  const required = catalog.mods.filter((mod) => mod.required === true).map((mod) => mod.id).sort();
  const features = catalog.mods.filter((mod) => "features" in mod.contributes).map((mod) => mod.id).sort();
  assert.deepEqual(required, features, "todo recurso é essencial");
  assert.ok(catalog.mods.filter((mod) => !mod.required).every((mod) => "llmEngines" in mod.contributes || "agents" in mod.contributes), "motores e agentes se desligam");
  assert.equal(legacy.mods.length, catalog.mods.length, "todos cabem no formato antigo");
  assert.ok(legacy.mods.filter((mod) => mod.kind === "feature").every((mod) => mod.defaultOn === true));
});

test("a valid mod of each extension point passes", () => {
  assert.deepEqual(manifestProblems(stats(), "stats", engines), []);
  assert.deepEqual(manifestProblems(localAi(), "local-ai", engines), []);
  assert.deepEqual(manifestProblems(base("claude", { llmEngines: ["claude"] }), "claude", engines), []);
  const bundle = base("power-pack", { features: ["stats", "mcp"], agents: [api] }, { requires: ["claude"], author: "Someone" });
  assert.deepEqual(manifestProblems(bundle, "power-pack", engines), [], "um mod pode trazer vários pontos de uma vez");
});

test("the id is the folder, and a mod named after an engine brings it", () => {
  assert.ok(manifestProblems(stats(), "other", engines).some((problem) => problem.includes("folder name")));
  assert.ok(manifestProblems(base("stats", { features: ["mcp"] }), "stats", engines).some((problem) => problem.includes("must bring it")));
  assert.ok(manifestProblems(base("x", { features: ["unknown"] }), "x", engines).some((problem) => problem.includes("engines.json")));
  assert.ok(manifestProblems(base("Local-AI", { agents: [api] }), "Local-AI", engines).some((problem) => problem.includes("lowercase")));
});

test("contributes names only extension points of the app", () => {
  assert.ok(manifestProblems(base("x", {}), "x", engines).some((problem) => problem.includes("at least one extension point")));
  assert.ok(manifestProblems(base("x", { themes: ["dark"] }), "x", engines).some((problem) => problem.includes("contributes.themes")));
  assert.ok(manifestProblems(base("x", { features: [] }), "x", engines).some((problem) => problem.includes("non-empty")));
  assert.ok(manifestProblems(base("x", { features: ["stats", "stats"] }), "x", engines).some((problem) => problem.includes("repeats")));
  assert.ok(manifestProblems(base("x", { agents: [api, api, api, api, api] }), "x", engines).some((problem) => problem.includes("1 to 4")));
});

test("a mod asks for the app that knows its extension points", () => {
  const original = POINTS.features.since;
  POINTS.features.since = "0.96.0";
  try {
    assert.ok(manifestProblems(stats(), "stats", engines).some((problem) => problem.includes("needs minApp 0.96.0")));
    assert.deepEqual(manifestProblems(stats({ minApp: "0.96.0" }), "stats", engines), []);
  } finally {
    POINTS.features.since = original;
  }
});

test("every text comes in the ten locales", () => {
  const { de: _removed, ...nine } = texts("Statistics");
  assert.ok(manifestProblems(stats({ title: nine }), "stats", engines).some((problem) => problem.includes("title.de")));
  assert.ok(manifestProblems(stats({ summary: { ...texts("x"), xx: "y" } }), "stats", engines).some((problem) => problem.includes("not a locale")));
});

test("unknown and malformed fields are refused", () => {
  assert.ok(manifestProblems(stats({ kind: "feature" }), "stats", engines).some((problem) => problem.includes("kind is not a field")));
  assert.ok(manifestProblems(stats({ version: "1.0" }), "stats", engines).some((problem) => problem.includes("version")));
  assert.ok(manifestProblems(stats({ preinstalled: "yes" }), "stats", engines).some((problem) => problem.includes("preinstalled")));
  assert.ok(manifestProblems(stats({ requires: ["stats"] }), "stats", engines).some((problem) => problem.includes("itself")));
  assert.ok(manifestProblems(stats({ author: " x" }), "stats", engines).some((problem) => problem.includes("author")));
  assert.ok(manifestProblems(stats({ required: "yes" }), "stats", engines).some((problem) => problem.includes("required must")));
  assert.ok(manifestProblems(stats({ required: true, preinstalled: false }), "stats", engines).some((problem) => problem.includes("also preinstalled")));
  assert.deepEqual(manifestProblems(stats({ required: true }), "stats", engines), []);
});

test("a command-line agent follows the rules of the app", () => {
  const cli = (patch) => localAi({ contributes: { agents: [{ kind: "cli", command: "local-ai", args: ["--model", "{model}", "{prompt}"], planArgs: [], edits: false, models: [], ...patch }] } });
  assert.deepEqual(manifestProblems(cli({}), "local-ai", engines), []);
  assert.ok(manifestProblems(cli({ args: ["{file}"] }), "local-ai", engines).some((problem) => problem.includes("{file}") && problem.includes("agents[0].args")));
  assert.ok(manifestProblems(cli({ edits: true }), "local-ai", engines).some((problem) => problem.includes("planArgs")));
  assert.ok(manifestProblems(cli({ command: "local ai" }), "local-ai", engines).some((problem) => problem.includes("without arguments")));
});

test("the old format gets the mods it can say", () => {
  assert.deepEqual(legacyEntry(stats()), { id: "stats", kind: "feature", category: "project", plan: "stats", defaultOn: true, minApp: "0.94.0", title: texts("stats"), summary: texts("stats.") });
  assert.equal(legacyEntry(stats({ preinstalled: false })).defaultOn, false, "o que não se instala sozinho nasce desligado no app antigo");
  assert.ok(!("required" in legacyEntry(stats({ required: true }))), "o formato antigo não diz o essencial");
  assert.deepEqual(legacyEntry(localAi()).template, api);
  assert.equal(legacyEntry(localAi()).kind, "template");
  assert.equal(legacyEntry(base("pack", { features: ["stats", "mcp"] })), null, "dois recursos não cabem");
  assert.equal(legacyEntry(base("pack", { features: ["stats"] })), null, "o recurso de outro nome não cabe");
  assert.equal(legacyEntry({ ...stats(), requires: ["claude"] }), null, "dependências não cabem");
});

test("an engine needs a mod in both catalogs unless it is withdrawn", () => {
  assert.deepEqual(buildCatalog(folder(essentials())).problems, []);
  assert.ok(buildCatalog(folder([stats(), base("mcp", { features: ["mcp"] })])).problems.some((problem) => problem.includes("engine claude")));
  const { catalog, problems } = buildCatalog(folder([stats(), base("mcp", { features: ["mcp"] })], { ...engines, withdrawn: ["claude"] }));
  assert.deepEqual(problems, []);
  assert.deepEqual(catalog.mods.map((mod) => mod.id), ["stats", "mcp"]);
  // Só um pacote traz o recurso: o app 0.94 não o enxergaria.
  const pack = base("pack", { features: ["mcp"] });
  assert.ok(buildCatalog(folder([base("claude", { llmEngines: ["claude"] }), stats(), pack])).problems.some((problem) => problem.includes("engine mcp has no mod the old format")));
  assert.ok(buildCatalog(folder([...essentials(), pack], { ...engines, withdrawn: ["mcp"] })).problems.some((problem) => problem.includes("withdrawn")));
});

test("requires points at existing mods, without cycles", () => {
  const needs = (id, requires, patch = {}) => base(id, { agents: [api] }, { requires, ...patch });
  assert.deepEqual(buildCatalog(folder([...essentials(), needs("aa", ["stats"])])).problems, []);
  assert.ok(buildCatalog(folder([...essentials(), needs("aa", ["ghost"])])).problems.some((problem) => problem.includes("ghost")));
  assert.ok(buildCatalog(folder([...essentials(), needs("aa", ["bb"]), needs("bb", ["aa"])])).problems.some((problem) => problem.includes("cycle")));
  assert.ok(buildCatalog(folder([...essentials(), needs("aa", ["bb"], { preinstalled: true }), needs("bb", [])])).problems.some((problem) => problem.includes("preinstalled but requires bb")));
  assert.ok(buildCatalog(folder([...essentials(), needs("aa", ["bb"], { preinstalled: true, required: true }), needs("bb", [], { preinstalled: true })])).problems.some((problem) => problem.includes("required but requires bb")), "o essencial só depende de essenciais");
});

test("two mods never become the same agent", () => {
  assert.equal(agentIdOf("local-ai", 0), "mod-local-ai");
  assert.equal(agentIdOf("local-ai", 1), "mod-local-ai-2");
  const twin = base("aa", { agents: [api, api] });
  const clash = base("aa-2", { agents: [api] });
  assert.ok(buildCatalog(folder([...essentials(), twin, clash])).problems.some((problem) => problem.includes("mod-aa-2")));
});
