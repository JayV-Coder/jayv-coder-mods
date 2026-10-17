// node --test scripts/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { agentIdOf, buildCatalog, cleanIcon, iconProblems, legacyEntry, LOCALES, manifestProblems, needsAgentsV2, outputs, pageProblems, POINTS } from "./catalog.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const engines = { llm: ["claude"], feature: ["stats", "mcp"], withdrawn: [] };
const texts = (text) => Object.fromEntries(LOCALES.map((locale) => [locale, text]));
const base = (id, contributes, patch = {}) => ({ id, version: "1.0.0", category: "project", plan: null, minApp: "0.94.0", icon: "icon.svg", title: texts(id), summary: texts(`${id}.`), contributes, ...patch });
const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M2 2h20v20H2z"/></svg>';
const stats = (patch = {}) => base("stats", { features: ["stats"] }, { plan: "stats", preinstalled: true, ...patch });
const api = { kind: "api", protocol: "openai", baseUrl: "http://localhost:8080/v1", keyRequired: false, models: [] };
const localAi = (patch = {}) => base("local-ai", { agents: [api] }, { category: "agents", plan: "customMods", ...patch });

/** A página mínima de um mod: o que ele faz e um passo de uso. */
const page = (patch = {}) => ({ about: texts("Does things."), use: [{ text: texts("Use it.") }], ...patch });

/** Uma pasta de mods de mentira, com `engines.json` e, por mod, o `mod.json`,
 * a `page.json` e os arquivos extras (`files`: caminho → conteúdo). */
function folder(mods, withEngines = engines, { pages = {}, files = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "mods-"));
  writeFileSync(join(dir, "engines.json"), JSON.stringify(withEngines));
  for (const mod of mods) {
    mkdirSync(join(dir, "mods", mod.id), { recursive: true });
    writeFileSync(join(dir, "mods", mod.id, "mod.json"), JSON.stringify(mod));
    writeFileSync(join(dir, "mods", mod.id, "icon.svg"), ICON);
    if (pages[mod.id] !== null) writeFileSync(join(dir, "mods", mod.id, "page.json"), JSON.stringify(pages[mod.id] ?? page()));
  }
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
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

/** No login, só os essenciais (os recursos do app) se instalam sozinhos;
 * motores, agentes e skills esperam quem quiser instalar (regra do dono). */
test("only the essentials come installed; the features are required and readable by the old app", () => {
  const { catalog, legacy } = buildCatalog(root);
  const preinstalled = catalog.mods.filter((mod) => mod.preinstalled === true && !mod.required).map((mod) => mod.id).sort();
  assert.deepEqual(preinstalled, [], "nada além dos essenciais se instala sozinho");
  assert.ok(catalog.mods.filter((mod) => mod.required).every((mod) => mod.preinstalled === true), "o essencial também é de fábrica");
  const required = catalog.mods.filter((mod) => mod.required === true).map((mod) => mod.id).sort();
  const features = catalog.mods.filter((mod) => "features" in mod.contributes).map((mod) => mod.id).sort();
  assert.deepEqual(required, features, "todo recurso é essencial");
  assert.ok(catalog.mods.filter((mod) => !mod.required).every((mod) => "llmEngines" in mod.contributes || "agents" in mod.contributes || "skills" in mod.contributes), "motores, agentes e skills se desligam");
  // O de skill e os agentes que só o app 0.107 lê (ACP, Responses, Manus,
  // `{prompt_file}`) ficam de fora do formato antigo.
  const old = catalog.mods.filter((mod) => !("skills" in mod.contributes) && !(mod.contributes.agents ?? []).some(needsAgentsV2));
  assert.equal(legacy.mods.length, old.length, "todos os de antes cabem no formato antigo; o de skill e os agentes novos ficam de fora");
  assert.ok(legacy.mods.some((mod) => mod.id === "deepseek"), "o DeepSeek, de API compatível com OpenAI, serve também ao app antigo");
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

test("an ACP agent and the new API protocols follow the rules of the app 0.107", () => {
  const acp = (patch = {}, mod = {}) => localAi({ minApp: "0.107.0", contributes: { agents: [{ kind: "acp", command: "kimi", args: ["acp"], env: { KIMI_X: "1" }, buildMode: "default", planMode: "plan", models: ["default"], ...patch }] }, ...mod });
  assert.deepEqual(manifestProblems(acp(), "local-ai", engines), []);
  assert.ok(manifestProblems(acp({}, { minApp: "0.106.1" }), "local-ai", engines).some((problem) => problem.includes("minApp 0.107.0")));
  assert.ok(manifestProblems(acp({ args: ["acp", "{prompt}"] }), "local-ai", engines).some((problem) => problem.includes("through the protocol")));
  assert.ok(manifestProblems(acp({ env: { PATH: "/x" } }), "local-ai", engines).some((problem) => problem.includes("env.PATH")));
  assert.ok(manifestProblems(acp({ planMode: "read only" }), "local-ai", engines).some((problem) => problem.includes("planMode")));
  assert.ok(manifestProblems(acp({ planArgs: ["x"] }), "local-ai", engines).some((problem) => problem.includes("planArgs is not a field")));
  const responses = (patch = {}) => localAi({ minApp: "0.107.0", contributes: { agents: [{ ...api, protocol: "responses", modelField: "preset", ...patch }] } });
  assert.deepEqual(manifestProblems(responses(), "local-ai", engines), []);
  assert.ok(manifestProblems(responses({ protocol: "openai" }), "local-ai", engines).some((problem) => problem.includes("modelField")));
  assert.deepEqual(manifestProblems(localAi({ minApp: "0.107.0", contributes: { agents: [{ ...api, protocol: "manus" }] } }), "local-ai", engines), []);
  const file = localAi({ contributes: { agents: [{ kind: "cli", command: "aider", args: ["--message-file", "{prompt_file}"], planArgs: [], edits: false, models: [] }] } });
  assert.ok(manifestProblems(file, "local-ai", engines).some((problem) => problem.includes("minApp 0.107.0")), "o {prompt_file} é do app 0.107");
  assert.equal(legacyEntry(acp()), null, "o app 0.94 não lê o agente ACP");
  assert.equal(legacyEntry(responses()), null);
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

const skill = (patch = {}) => ({ name: "reverse-engineering", description: "Inspect a compiled program without its source.", instructions: "Open the binary first.", ...patch });
const rea = (contributes = { skills: [skill()] }, patch = {}) => base("rea", contributes, { category: "agents", minApp: "0.103.0", ...patch });

test("a skill follows the rules of the app, and its MCP servers too", () => {
  assert.deepEqual(manifestProblems(rea(), "rea", engines), []);
  const server = { name: "rea", command: "npx", args: ["-y", "rea-agents@1.0.0", "--mcp"] };
  assert.deepEqual(manifestProblems(rea({ skills: [skill({ mcpServers: [server, { name: "docs", transport: "http", url: "https://mcp.example.com/mcp" }] })] }), "rea", engines), []);
  assert.ok(manifestProblems(rea({ skills: [skill()] }, { minApp: "0.102.0" }), "rea", engines).some((problem) => problem.includes("needs minApp 0.103.0")));
  const broken = [
    [skill({ name: "bad name" }), "name"],
    [skill({ description: "x".repeat(401) }), "description"],
    [(({ instructions: _gone, ...rest }) => rest)(skill()), "either instructions or file"],
    [skill({ file: "rea.md" }), "either instructions or file"],
    [skill({ mcpServers: [{ ...server, name: "jayv" }] }), "not jayv"],
    [skill({ mcpServers: [{ ...server, command: "npx -y" }] }), "without arguments"],
    [skill({ mcpServers: [server, server] }), "repeats a server"],
    [skill({ mcpServers: [{ name: "x", transport: "http", url: "ftp://x" }] }), "http(s)"],
  ];
  for (const [value, word] of broken) assert.ok(manifestProblems(rea({ skills: [value] }), "rea", engines).some((problem) => problem.includes(word)), word);
  assert.ok(manifestProblems(rea({ skills: [skill(), skill()] }), "rea", engines).some((problem) => problem.includes("repeats a skill")));
});

test("the instructions of a skill can live in a .md file of the mod, and two mods never bring the same skill", () => {
  const fromFile = rea({ skills: [{ name: "reverse-engineering", description: "Inspect programs.", file: "rea.md" }] });
  const { catalog, legacy, pages, problems } = buildCatalog(folder([...essentials(), fromFile], engines, { files: { "mods/rea/rea.md": "# Steps\n\nOpen the binary first.\n" } }));
  assert.deepEqual(problems, []);
  assert.equal(catalog.mods.find((mod) => mod.id === "rea").contributes.skills[0].instructions, "# Steps\n\nOpen the binary first.");
  assert.ok(!("file" in catalog.mods.find((mod) => mod.id === "rea").contributes.skills[0]));
  assert.ok(!legacy.mods.some((mod) => mod.id === "rea"), "o app antigo não tem skills de mod");
  assert.ok(pages.pages.rea);
  assert.ok(buildCatalog(folder([...essentials(), fromFile])).problems.some((problem) => problem.includes("rea.md is not in the folder")));
  const twin = base("other", { skills: [skill()] }, { minApp: "0.103.0" });
  assert.ok(buildCatalog(folder([...essentials(), rea(), twin])).problems.some((problem) => /skill reverse-engineering is also a skill of mods\/(rea|other)/.test(problem)));
});

test("every mod has a page, in the ten locales, with prints that exist", () => {
  const images = (entries) => new Map(Object.entries(entries));
  assert.deepEqual(pageProblems(page(), "stats", images({})), []);
  assert.ok(pageProblems(page({ about: { en: "Only English." } }), "stats", images({})).some((problem) => problem.includes("about.pt-BR")));
  assert.ok(pageProblems(page({ use: [] }), "stats", images({})).some((problem) => problem.includes("use must be a list of 1 to 6")));
  assert.ok(pageProblems(page({ use: [{ text: texts("x"), image: "chat" }] }), "stats", images({})).some((problem) => problem.includes("needs media/chat.en.webp")));
  assert.ok(pageProblems(page({ use: [{ text: texts("x"), image: "chat" }] }), "stats", images({ chat: ["pt-BR"] })).some((problem) => problem.includes("needs media/chat.en.webp")));
  assert.deepEqual(pageProblems(page({ use: [{ text: texts("x"), image: "chat" }] }), "stats", images({ chat: ["en", "ja"] })), []);
  assert.ok(pageProblems(page(), "stats", images({ old: ["en"] })).some((problem) => problem.includes("old is not used")));
  assert.ok(pageProblems(page({ use: [{ text: texts("x"), image: "enable" }] }), "stats", images({ enable: ["en"] })).some((problem) => problem.includes("(not enable)")));
  assert.ok(pageProblems(page({ extra: 1 }), "stats", images({})).some((problem) => problem.includes("extra is not a field")));
  assert.ok(buildCatalog(folder(essentials(), engines, { pages: { stats: null } })).problems.some((problem) => problem.includes("mods/stats: missing page.json")));
});

test("pages.json lists the prints of each page with their locales and a mark of the content", () => {
  const withShots = page({ requirements: texts("A key."), setup: [{ text: texts("Paste the key."), image: "settings" }], use: [{ text: texts("Ask."), image: "chat" }] });
  const files = {
    "mods/stats/media/enable.en.webp": "e", "mods/stats/media/enable.pt-BR.webp": "e2",
    "mods/stats/media/settings.en.webp": "s", "mods/stats/media/chat.en.webp": "c", "mods/stats/media/chat.ja.webp": "c2",
  };
  const { pages, problems } = buildCatalog(folder(essentials(), engines, { pages: { stats: withShots }, files }));
  assert.deepEqual(problems, []);
  const built = pages.pages.stats;
  assert.equal(pages.schema, 1);
  assert.equal(built.version, "1.0.0");
  assert.deepEqual(built.enable.locales, ["en", "pt-BR"]);
  assert.deepEqual(built.use[0].image.locales, ["en", "ja"], "na ordem dos idiomas do app");
  assert.match(built.use[0].image.v, /^[0-9a-f]{10}$/);
  assert.equal(built.setup[0].image.name, "settings");
  assert.deepEqual(built.requirements, texts("A key."));
  assert.equal(pages.pages.claude.enable, null, "sem print, sem imagem");
  const bad = buildCatalog(folder(essentials(), engines, { files: { "mods/stats/media/enable.xx.webp": "e", "mods/stats/media/Shot.en.png": "p" } }));
  assert.ok(bad.problems.some((problem) => problem.includes("enable.xx.webp")) && bad.problems.some((problem) => problem.includes("Shot.en.png")));
});

test("every mod has an icon, and an icon is only a drawing", () => {
  const { catalog } = buildCatalog(root);
  assert.ok(catalog.mods.every((mod) => typeof mod.icon === "string" && mod.icon.startsWith("<svg") && mod.icon.endsWith("</svg>")), "o catálogo leva o desenho, não o nome do arquivo");
  assert.ok(catalog.mods.every((mod) => iconProblems(mod.id, mod.icon).length === 0));
  const { icon, ...without } = stats();
  assert.ok(manifestProblems(without, "stats", engines).some((problem) => problem.includes("icon must be an .svg file")));
  assert.ok(manifestProblems(stats({ icon: "icon.png" }), "stats", engines).some((problem) => problem.includes("icon must be an .svg file")));
  const bad = (svg) => iconProblems("x.svg", svg);
  assert.deepEqual(bad(ICON), []);
  assert.ok(bad('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>').some((problem) => problem.includes("viewBox")));
  assert.ok(bad('<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>').some((problem) => problem.includes("<script>")));
  assert.ok(bad('<svg viewBox="0 0 1 1" onload="alert(1)"><path d="M0 0"/></svg>').some((problem) => problem.includes("event")));
  assert.ok(bad('<svg viewBox="0 0 1 1"><image href="https://example.com/a.png"/></svg>').some((problem) => problem.includes("href")));
  assert.ok(bad('<svg viewBox="0 0 1 1"><path fill="url(https://example.com/x)" d="M0 0"/></svg>').some((problem) => problem.includes("url()")));
  assert.ok(bad('<svg viewBox="0 0 1 1"><foreignObject/></svg>').some((problem) => problem.includes("<foreignObject>")));
  assert.deepEqual(bad('<svg viewBox="0 0 1 1"><image href="data:image/png;base64,iVBORw0KGgo="/><path fill="url(#g)" d="M0 0"/></svg>'), []);
  assert.equal(cleanIcon('<!-- license -->\n<svg\n  class="lucide"\n  width="24"\n  viewBox="0 0 24 24"\n>\n  <path d="M1 1" />\n</svg>\n'), '<svg viewBox="0 0 24 24"><path d="M1 1"/></svg>');
  const dir = folder([stats()], engines, { files: { "mods/stats/icon.svg": '<svg viewBox="0 0 1 1"><script/></svg>' } });
  assert.ok(buildCatalog(dir).problems.some((problem) => problem.includes("mods/stats/icon.svg")));
});
