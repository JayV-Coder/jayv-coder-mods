#!/usr/bin/env node
// O catálogo dos mods do JayV. Cada mod é um `mods/<id>/mod.json`; este script
// confere todos e monta os dois catálogos que a função `mods` do Supabase
// entrega ao app e ao site:
//
//   catalog.v2.json  o formato genérico (SCHEMA 2): cada mod diz o que traz
//                    para cada ponto de extensão do app (`contributes`).
//   catalog.json     o formato antigo (SCHEMA 1), tirado do v2, para o app
//                    0.94 e o site 2.12, que só o conhecem. Um mod que não
//                    cabe nele (dependências, mais de um ponto) fica de fora.
//
//   node scripts/catalog.mjs check   confere os manifestos e se os catálogos estão em dia
//   node scripts/catalog.mjs build   confere e grava os dois catálogos
//
// Sem dependências: roda com o Node puro, no Actions e na máquina de quem edita.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** A versão do formato do catálogo genérico. O app e o site ignoram um
 * catálogo de formato que não conhecem e ficam com o último que entenderam. */
export const SCHEMA = 2;
/** O formato antigo, que o `catalog.json` continua seguindo. */
export const LEGACY_SCHEMA = 1;

/** Os idiomas do app (`public.locales`): todo texto de mod vem nos dez. */
export const LOCALES = ["en", "pt-BR", "es", "zh-CN", "hi", "ar", "fr", "ru", "ja", "de"];

/** As categorias do manual do app (`docs/manual/index.json`). */
export const CATEGORIES = ["start", "chat", "agents", "gate", "privacy", "project", "team", "account", "app"];

/** A ordem dos campos no manifesto e no catálogo; um campo fora daqui é erro
 * de digitação. */
const FIELDS = ["$schema", "id", "version", "category", "plan", "minApp", "preinstalled", "required", "requires", "author", "docs", "homepage", "title", "summary", "contributes"];
/** A ordem dos campos do formato antigo. */
const LEGACY_FIELDS = ["id", "kind", "category", "plan", "defaultOn", "minApp", "docs", "homepage", "title", "summary", "template"];
const AGENT_FIELDS = {
  api: ["kind", "protocol", "baseUrl", "keyRequired", "models"],
  cli: ["kind", "command", "args", "planArgs", "edits", "models"],
};

const ID = /^[a-z][A-Za-z0-9-]{1,39}$/;
const ENGINE_ID = /^[a-z][A-Za-z0-9]{1,39}$/;
/** O mod que traz agentes vira os agentes `mod-<id>`, `mod-<id>-2`… no app:
 * o id segue o slug dos mods criados (`mods::custom`), com até 28 caracteres. */
const AGENT_MOD_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const AGENT_MOD_ID_MAX = 28;
const MAX_AGENTS = 4;
const PLAN = /^[a-z][A-Za-z]{1,39}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const DOCS = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
const TITLE_MAX = 60;
const SUMMARY_MAX = 400;
const AUTHOR_MAX = 60;
const MAX_REQUIRES = 16;
const MODEL = /^[A-Za-z0-9._:/@[\]-]{1,120}$/;
const MAX_MODELS = 50;
const MAX_ARGS = 64;
const MAX_ARG = 1000;
const PLACEHOLDER = /\{[A-Za-z0-9_]+\}/g;

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value) => typeof value === "string" && value.trim().length > 0;

/** `1.2.3` em números, para comparar versões. */
const parts = (version) => version.split(".").map(Number);
export function compareVersions(a, b) {
  const [x, y] = [parts(a), parts(b)];
  for (let index = 0; index < 3; index++) if (x[index] !== y[index]) return x[index] - y[index];
  return 0;
}

/** O id do agente que a entrada `index` do ponto `agents` vira no app. */
export const agentIdOf = (modId, index) => (index === 0 ? `mod-${modId}` : `mod-${modId}-${index + 1}`);

/** Os textos de um campo: os dez idiomas, nenhum vazio, nenhum a mais. */
function textProblems(where, field, value, max) {
  if (!isObject(value)) return [`${where}: ${field} must be an object with the ten locales`];
  const found = [];
  for (const locale of LOCALES) {
    if (!isText(value[locale])) found.push(`${where}: ${field}.${locale} is missing`);
    else if (value[locale].length > max) found.push(`${where}: ${field}.${locale} is longer than ${max} characters`);
    else if (value[locale] !== value[locale].trim()) found.push(`${where}: ${field}.${locale} has spaces at the ends`);
  }
  for (const locale of Object.keys(value)) if (!LOCALES.includes(locale)) found.push(`${where}: ${field}.${locale} is not a locale of the app`);
  return found;
}

/** A mesma conferência que o app faz numa linha de comando de mod
 * (`mods::custom`): argumentos não vazios, sem quebra de linha, e só
 * `{model}` (em qualquer parte) e `{prompt}` (sozinho num argumento). */
function lineProblems(label, args) {
  if (!Array.isArray(args)) return [`${label} must be a list of arguments`];
  if (args.length > MAX_ARGS) return [`${label} takes at most ${MAX_ARGS} arguments`];
  const found = [];
  for (const arg of args) {
    // eslint-disable-next-line no-control-regex
    if (typeof arg !== "string" || arg === "" || arg.length > MAX_ARG || /[\u0000-\u001f\u007f]/.test(arg)) {
      found.push(`${label} has an empty, multi-line or too long argument`);
      continue;
    }
    const rest = arg === "{prompt}" ? "" : arg.replaceAll("{model}", "");
    for (const token of rest.match(PLACEHOLDER) ?? []) found.push(`${label} uses ${token}; only {model} and {prompt} (alone in an argument) are accepted`);
  }
  return found;
}

/** Um agente de linha de comando ou de API: a definição de um mod criado, sem
 * o que é da máquina (a chave, a aprovação dos servidores MCP). */
function agentProblems(where, agent) {
  if (!isObject(agent)) return [`${where} must be an object`];
  const fields = AGENT_FIELDS[agent.kind];
  if (!fields) return [`${where}.kind must be api or cli`];
  const found = [];
  for (const key of Object.keys(agent)) if (!fields.includes(key)) found.push(`${where}.${key} is not a field of a ${agent.kind} agent`);
  const models = agent.models ?? [];
  if (!Array.isArray(models) || models.length > MAX_MODELS || models.some((model) => typeof model !== "string" || !MODEL.test(model))) {
    found.push(`${where}.models must be a list of up to ${MAX_MODELS} model ids`);
  } else if (new Set(models).size !== models.length) {
    found.push(`${where}.models repeats a model`);
  }
  if (agent.kind === "api") {
    if (!["openai", "anthropic"].includes(agent.protocol)) found.push(`${where}.protocol must be openai or anthropic`);
    if (typeof agent.baseUrl !== "string" || !/^https?:\/\/[^\s/@]+/i.test(agent.baseUrl)) found.push(`${where}.baseUrl must be an http(s) address`);
    if (typeof agent.keyRequired !== "boolean") found.push(`${where}.keyRequired must be true or false`);
  } else {
    if (typeof agent.command !== "string" || !agent.command.trim() || /\s/.test(agent.command)) found.push(`${where}.command must be the program name, without arguments`);
    found.push(...lineProblems(`${where}.args`, agent.args ?? []));
    found.push(...lineProblems(`${where}.planArgs`, agent.planArgs ?? []));
    if (typeof (agent.edits ?? false) !== "boolean") found.push(`${where}.edits must be true or false`);
    if (agent.edits === true && (agent.planArgs ?? []).length === 0) found.push(`${where}: an agent that writes to the project needs planArgs that do not`);
  }
  return found;
}

/** Uma lista de motores do app de um tipo, sem repetir. */
function engineListProblems(where, value, engines, kind) {
  if (!Array.isArray(value) || value.length === 0) return [`${where} must be a non-empty list of ${kind} engines`];
  const found = [];
  for (const id of value) {
    if (typeof id !== "string" || !ENGINE_ID.test(id)) found.push(`${where} has an invalid id`);
    else if (!engines[kind].includes(id)) found.push(`${where}: ${id} is not a ${kind} engine of the app (engines.json)`);
  }
  if (new Set(value).size !== value.length) found.push(`${where} repeats an engine`);
  return found;
}

/**
 * Os pontos de extensão do app: o que um mod pode trazer. Cada um é uma chave
 * de `contributes`, e `since` é a versão do app que o conhece — um mod que usa
 * um ponto pede pelo menos essa versão (`minApp`). Ponto novo só chega com uma
 * versão nova do app: primeiro o app aprende a aplicá-lo, depois ele entra
 * aqui. `legacy` diz como o mod de um ponto só aparece no formato antigo (nulo:
 * não aparece).
 *
 * - `features`   liga recursos opcionais do app (engines.json › feature).
 * - `llmEngines` liga motores de integração com LLM do app (engines.json › llm).
 * - `agents`     instala agentes de linha de comando ou de API como agentes de
 *                quem instala (`mod-<id>`, `mod-<id>-2`…).
 */
export const POINTS = {
  llmEngines: {
    since: "0.94.0",
    problems: (where, value, { engines }) => engineListProblems(where, value, engines, "llm"),
    engines: (value) => value,
    legacy: (mod, value) => (value.length === 1 && value[0] === mod.id ? { kind: "llm" } : null),
  },
  features: {
    since: "0.94.0",
    problems: (where, value, { engines }) => engineListProblems(where, value, engines, "feature"),
    engines: (value) => value,
    legacy: (mod, value) => (value.length === 1 && value[0] === mod.id ? { kind: "feature", defaultOn: mod.preinstalled === true } : null),
  },
  agents: {
    since: "0.94.0",
    problems: (where, value, { id }) => {
      if (!Array.isArray(value) || value.length === 0 || value.length > MAX_AGENTS) return [`${where} must be a list of 1 to ${MAX_AGENTS} agents`];
      const found = [];
      if (typeof id !== "string" || !AGENT_MOD_ID.test(id) || id.length > AGENT_MOD_ID_MAX) found.push(`${where}: a mod with agents has an id of lowercase letters, digits and -, up to ${AGENT_MOD_ID_MAX} characters`);
      value.forEach((agent, index) => found.push(...agentProblems(`${where}[${index}]`, agent)));
      return found;
    },
    engines: () => [],
    legacy: (_mod, value) => (value.length === 1 ? { kind: "template", template: value[0] } : null),
  },
};

/** A ordem em que os pontos aparecem (e a ordem dos mods no catálogo). */
const POINT_ORDER = ["llmEngines", "features", "agents"];

/** Tudo que está errado num manifesto, sozinho. `folder` é o nome da pasta,
 * que tem de ser o id. As dependências (`requires`) são conferidas com o
 * catálogo inteiro, em `buildCatalog`. */
export function manifestProblems(manifest, folder, engines) {
  const where = `mods/${folder}/mod.json`;
  if (!isObject(manifest)) return [`${where}: must be a JSON object`];
  const found = [];
  for (const key of Object.keys(manifest)) if (!FIELDS.includes(key)) found.push(`${where}: ${key} is not a field of a mod`);
  const { id } = manifest;
  if (id !== folder) found.push(`${where}: id must be the folder name (${folder})`);
  if (typeof id !== "string" || !ID.test(id)) found.push(`${where}: invalid id`);
  if (typeof manifest.version !== "string" || !VERSION.test(manifest.version)) found.push(`${where}: version must be the version of the mod, like 1.0.0`);
  if (!CATEGORIES.includes(manifest.category)) found.push(`${where}: category must be one of ${CATEGORIES.join(", ")}`);
  if (manifest.plan !== null && (typeof manifest.plan !== "string" || !PLAN.test(manifest.plan))) found.push(`${where}: plan must be a plan feature key or null`);
  const minApp = typeof manifest.minApp === "string" && VERSION.test(manifest.minApp) ? manifest.minApp : null;
  if (!minApp) found.push(`${where}: minApp must be a version like 0.95.0`);
  if ("preinstalled" in manifest && typeof manifest.preinstalled !== "boolean") found.push(`${where}: preinstalled must be true or false`);
  // Essencial: o app precisa dele. Vem instalado e ligado e ninguém o
  // desliga nem desinstala — então também se instala sozinho.
  if ("required" in manifest && typeof manifest.required !== "boolean") found.push(`${where}: required must be true or false`);
  else if (manifest.required === true && manifest.preinstalled !== true) found.push(`${where}: a required mod is also preinstalled`);
  if ("requires" in manifest) {
    const requires = manifest.requires;
    if (!Array.isArray(requires) || requires.length > MAX_REQUIRES || requires.some((other) => typeof other !== "string" || !ID.test(other))) found.push(`${where}: requires must be a list of up to ${MAX_REQUIRES} mod ids`);
    else if (new Set(requires).size !== requires.length) found.push(`${where}: requires repeats a mod`);
    else if (requires.includes(id)) found.push(`${where}: a mod cannot require itself`);
  }
  if ("author" in manifest && (!isText(manifest.author) || manifest.author.length > AUTHOR_MAX || manifest.author !== manifest.author.trim())) found.push(`${where}: author must be a name of up to ${AUTHOR_MAX} characters`);
  if ("docs" in manifest && (typeof manifest.docs !== "string" || !DOCS.test(manifest.docs))) found.push(`${where}: docs must be the id of a page of the manual`);
  if ("homepage" in manifest && (typeof manifest.homepage !== "string" || !/^https:\/\/[^\s/@]+/i.test(manifest.homepage))) found.push(`${where}: homepage must be an https address`);
  found.push(...textProblems(where, "title", manifest.title, TITLE_MAX));
  found.push(...textProblems(where, "summary", manifest.summary, SUMMARY_MAX));

  const contributes = manifest.contributes;
  if (!isObject(contributes) || Object.keys(contributes).length === 0) return [...found, `${where}: contributes must say what the mod adds to at least one extension point (${POINT_ORDER.join(", ")})`];
  for (const [key, value] of Object.entries(contributes)) {
    const point = POINTS[key];
    if (!point) { found.push(`${where}: contributes.${key} is not an extension point of the app (${POINT_ORDER.join(", ")})`); continue; }
    found.push(...point.problems(`${where}: contributes.${key}`, value, { engines, id }));
    if (minApp && compareVersions(minApp, point.since) < 0) found.push(`${where}: contributes.${key} needs minApp ${point.since} or newer`);
  }
  // O mod com o nome de um motor do app é o mod daquele motor: ele o traz.
  for (const kind of ["llm", "feature"]) {
    const key = kind === "llm" ? "llmEngines" : "features";
    if (engines[kind].includes(id) && !(Array.isArray(contributes[key]) && contributes[key].includes(id))) found.push(`${where}: ${id} is the id of a ${kind} engine of the app, so the mod must bring it in contributes.${key}`);
  }
  return found;
}

/** O manifesto como vai no catálogo genérico: sem o `$schema` e com os campos
 * na ordem de sempre, para o catálogo só mudar quando um mod muda. */
function entry(manifest) {
  const out = {};
  for (const key of FIELDS) if (key !== "$schema" && key in manifest) out[key] = manifest[key];
  const contributes = {};
  for (const key of POINT_ORDER) if (key in manifest.contributes) contributes[key] = manifest.contributes[key];
  out.contributes = contributes;
  return out;
}

/** O mod no formato antigo, ou nulo quando ele não cabe nele: dependências,
 * mais de um ponto ou um ponto que o formato antigo não diz. */
export function legacyEntry(mod) {
  const keys = Object.keys(mod.contributes);
  if (keys.length !== 1 || (mod.requires ?? []).length > 0) return null;
  const shape = POINTS[keys[0]].legacy(mod, mod.contributes[keys[0]]);
  if (!shape) return null;
  const full = { ...mod, ...shape };
  if (shape.kind !== "feature") delete full.defaultOn;
  const out = {};
  for (const key of LEGACY_FIELDS) if (key in full && full[key] !== undefined) out[key] = full[key];
  return out;
}

/** O grupo de um mod na ordem do catálogo: o primeiro ponto que ele usa, na
 * ordem dos pontos, e a posição do motor (ou o id). */
const ORDER = (engines) => {
  const rank = (mod) => {
    const key = POINT_ORDER.find((point) => point in mod.contributes) ?? "";
    const group = POINT_ORDER.indexOf(key);
    const engine = key === "llmEngines" ? engines.llm.indexOf(mod.id) : key === "features" ? engines.feature.indexOf(mod.id) : -1;
    return { group, engine: engine === -1 ? Number.MAX_SAFE_INTEGER : engine };
  };
  return (a, b) => {
    const [x, y] = [rank(a), rank(b)];
    return x.group - y.group || x.engine - y.engine || a.id.localeCompare(b.id);
  };
};

/** A ordem do formato antigo, a mesma de antes: llm, feature, template. */
const LEGACY_ORDER = (engines) => {
  const kinds = ["llm", "feature", "template"];
  return (a, b) => {
    const kind = kinds.indexOf(a.kind) - kinds.indexOf(b.kind);
    if (kind) return kind;
    if (a.kind === "template") return a.id.localeCompare(b.id);
    return engines[a.kind].indexOf(a.id) - engines[b.kind].indexOf(b.id);
  };
};

/** Os motores do app, conferidos. */
export function readEngines(root) {
  const engines = JSON.parse(readFileSync(join(root, "engines.json"), "utf8"));
  const found = [];
  for (const group of ["llm", "feature", "withdrawn"]) {
    if (!Array.isArray(engines[group]) || engines[group].some((id) => typeof id !== "string" || !ENGINE_ID.test(id))) found.push(`engines.json: ${group} must be a list of ids`);
  }
  return { engines, problems: found };
}

/** As dependências: todo mod pedido existe, sem ciclo, e o mod que se instala
 * sozinho só pede mods que também se instalam sozinhos. */
function requiresProblems(mods) {
  const byId = new Map(mods.map((mod) => [mod.id, mod]));
  const found = [];
  for (const mod of mods) {
    for (const other of mod.requires ?? []) {
      const target = byId.get(other);
      if (!target) found.push(`mods/${mod.id}/mod.json: requires ${other}, which is not in mods/`);
      else if (mod.preinstalled && !target.preinstalled) found.push(`mods/${mod.id}/mod.json: is preinstalled but requires ${other}, which is not`);
      else if (mod.required && !target.required) found.push(`mods/${mod.id}/mod.json: is required but requires ${other}, which could be turned off`);
    }
  }
  // Um ciclo deixaria os dois mods esperando um pelo outro para sempre.
  const state = new Map();
  const visit = (id, path) => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "open") { found.push(`requires has a cycle: ${[...path, id].join(" → ")}`); return; }
    state.set(id, "open");
    for (const other of byId.get(id)?.requires ?? []) if (byId.has(other)) visit(other, [...path, id]);
    state.set(id, "done");
  };
  for (const mod of mods) visit(mod.id, []);
  return found;
}

/** Lê e confere todos os mods. Devolve os dois catálogos e o que está errado. */
export function buildCatalog(root) {
  const { engines, problems } = readEngines(root);
  if (problems.length) return { catalog: null, legacy: null, problems };
  const found = [];
  const folders = readdirSync(join(root, "mods"), { withFileTypes: true }).filter((item) => item.isDirectory()).map((item) => item.name).sort();
  const mods = [];
  for (const folder of folders) {
    const file = join(root, "mods", folder, "mod.json");
    if (!existsSync(file)) { found.push(`mods/${folder}: missing mod.json`); continue; }
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      found.push(`mods/${folder}/mod.json: invalid JSON (${error.message})`);
      continue;
    }
    const problems = manifestProblems(manifest, folder, engines);
    if (problems.length) found.push(...problems);
    else mods.push(entry(manifest));
  }
  found.push(...requiresProblems(mods));
  // Dois mods não podem virar o mesmo agente no app.
  const agents = new Map();
  for (const mod of mods) {
    (mod.contributes.agents ?? []).forEach((_agent, index) => {
      const agent = agentIdOf(mod.id, index);
      if (agents.has(agent)) found.push(`mods/${mod.id}/mod.json: agent ${agent} is also an agent of mods/${agents.get(agent)}`);
      else agents.set(agent, mod.id);
    });
  }
  const legacy = mods.map(legacyEntry).filter((mod) => mod !== null);
  // Todo motor tem quem o traga, a não ser que a retirada seja de propósito —
  // no catálogo genérico e no antigo, que o app 0.94 ainda lê: um motor sem
  // mod ali sai do ar para quem não atualizou.
  for (const kind of ["llm", "feature"]) {
    const key = kind === "llm" ? "llmEngines" : "features";
    for (const id of engines[kind]) {
      const brought = mods.some((mod) => POINTS[key].engines(mod.contributes[key] ?? []).includes(id));
      if (engines.withdrawn.includes(id)) {
        if (brought) found.push(`engines.json: ${id} is withdrawn but a mod still brings it`);
        continue;
      }
      if (!brought) found.push(`engine ${id} has no mod that brings it; to withdraw it from everyone, list it in engines.json withdrawn`);
      else if (!legacy.some((mod) => mod.kind === kind && mod.id === id)) found.push(`engine ${id} has no mod the old format can say (a mod named ${id} that brings only it): the app 0.94 would turn it off`);
    }
  }
  if (found.length) return { catalog: null, legacy: null, problems: found };
  mods.sort(ORDER(engines));
  legacy.sort(LEGACY_ORDER(engines));
  return { catalog: { schema: SCHEMA, mods }, legacy: { schema: LEGACY_SCHEMA, mods: legacy }, problems: [] };
}

export const serialize = (catalog) => `${JSON.stringify(catalog, null, 2)}\n`;

/** Os arquivos que o build grava, com o conteúdo de cada um. */
export const outputs = ({ catalog, legacy }) => [["catalog.v2.json", serialize(catalog)], ["catalog.json", serialize(legacy)]];

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const command = process.argv[2];
  if (command !== "check" && command !== "build") {
    console.error("usage: node scripts/catalog.mjs check|build");
    process.exit(2);
  }
  const built = buildCatalog(root);
  if (built.problems.length) {
    for (const problem of built.problems) console.error(`✗ ${problem}`);
    process.exit(1);
  }
  const files = outputs(built);
  if (command === "build") {
    for (const [name, text] of files) writeFileSync(join(root, name), text);
    console.log(`catalog.v2.json: ${built.catalog.mods.length} mods; catalog.json: ${built.legacy.mods.length} mods`);
    return;
  }
  let stale = false;
  for (const [name, text] of files) {
    const target = join(root, name);
    const current = existsSync(target) ? readFileSync(target, "utf8") : "";
    if (current !== text) {
      console.error(`✗ ${name} is out of date: run node scripts/catalog.mjs build and commit it`);
      stale = true;
    }
  }
  if (stale) process.exit(1);
  console.log(`catalog.v2.json: ok, ${built.catalog.mods.length} mods; catalog.json: ok, ${built.legacy.mods.length} mods`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
