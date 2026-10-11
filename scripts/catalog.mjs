#!/usr/bin/env node
// O catálogo dos mods do JayV. Cada mod é um `mods/<id>/mod.json`; este script
// confere todos e monta o `catalog.json` que a função `mods` do Supabase
// entrega ao app e ao site.
//
//   node scripts/catalog.mjs check   confere os manifestos e se o catalog.json está em dia
//   node scripts/catalog.mjs build   confere e grava o catalog.json
//
// Sem dependências: roda com o Node puro, no Actions e na máquina de quem edita.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** A versão do formato do catálogo. O app e o site ignoram um catálogo de
 * formato que não conhecem e ficam com o último que entenderam. */
export const SCHEMA = 1;

/** Os idiomas do app (`public.locales`): todo texto de mod vem nos dez. */
export const LOCALES = ["en", "pt-BR", "es", "zh-CN", "hi", "ar", "fr", "ru", "ja", "de"];

/** `llm`: liga um motor de integração com LLM do app (Claude Code, Codex…).
 * `feature`: liga um recurso do app (estatísticas, portaria, MCP…).
 * `template`: um mod pronto que a pessoa instala como um mod seu (um programa
 * de linha de comando ou uma API compatível com OpenAI ou Anthropic). */
export const KINDS = ["llm", "feature", "template"];

/** As categorias do manual do app (`docs/manual/index.json`). */
export const CATEGORIES = ["start", "chat", "agents", "gate", "privacy", "project", "team", "account", "app"];

/** A ordem dos campos no catálogo; um campo fora daqui é erro de digitação. */
const FIELDS = ["$schema", "id", "kind", "category", "plan", "defaultOn", "minApp", "docs", "homepage", "title", "summary", "template"];
const TEMPLATE_FIELDS = {
  api: ["kind", "protocol", "baseUrl", "keyRequired", "models"],
  cli: ["kind", "command", "args", "planArgs", "edits", "models"],
};

const ENGINE_ID = /^[a-z][A-Za-z0-9]{1,39}$/;
/** O mod pronto vira o agente `mod-<id>` no app: o id segue o slug dos mods
 * criados (`mods::custom`), com até 28 caracteres. */
const TEMPLATE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TEMPLATE_ID_MAX = 28;
const PLAN = /^[a-z][A-Za-z]{1,39}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const DOCS = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
const TITLE_MAX = 60;
const SUMMARY_MAX = 400;
const MODEL = /^[A-Za-z0-9._:/@[\]-]{1,120}$/;
const MAX_MODELS = 50;
const MAX_ARGS = 64;
const MAX_ARG = 1000;
const PLACEHOLDER = /\{[A-Za-z0-9_]+\}/g;

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value) => typeof value === "string" && value.trim().length > 0;

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
function lineProblems(where, field, args) {
  if (!Array.isArray(args)) return [`${where}: template.${field} must be a list of arguments`];
  if (args.length > MAX_ARGS) return [`${where}: template.${field} takes at most ${MAX_ARGS} arguments`];
  const found = [];
  for (const arg of args) {
    // eslint-disable-next-line no-control-regex
    if (typeof arg !== "string" || arg === "" || arg.length > MAX_ARG || /[\u0000-\u001f\u007f]/.test(arg)) {
      found.push(`${where}: template.${field} has an empty, multi-line or too long argument`);
      continue;
    }
    const rest = arg === "{prompt}" ? "" : arg.replaceAll("{model}", "");
    for (const token of rest.match(PLACEHOLDER) ?? []) found.push(`${where}: template.${field} uses ${token}; only {model} and {prompt} (alone in an argument) are accepted`);
  }
  return found;
}

function templateProblems(where, template) {
  if (!isObject(template)) return [`${where}: a template mod needs the template object`];
  const fields = TEMPLATE_FIELDS[template.kind];
  if (!fields) return [`${where}: template.kind must be api or cli`];
  const found = [];
  for (const key of Object.keys(template)) if (!fields.includes(key)) found.push(`${where}: template.${key} is not a field of a ${template.kind} template`);
  const models = template.models ?? [];
  if (!Array.isArray(models) || models.length > MAX_MODELS || models.some((model) => typeof model !== "string" || !MODEL.test(model))) {
    found.push(`${where}: template.models must be a list of up to ${MAX_MODELS} model ids`);
  } else if (new Set(models).size !== models.length) {
    found.push(`${where}: template.models repeats a model`);
  }
  if (template.kind === "api") {
    if (!["openai", "anthropic"].includes(template.protocol)) found.push(`${where}: template.protocol must be openai or anthropic`);
    if (typeof template.baseUrl !== "string" || !/^https?:\/\/[^\s/@]+/i.test(template.baseUrl)) found.push(`${where}: template.baseUrl must be an http(s) address`);
    if (typeof template.keyRequired !== "boolean") found.push(`${where}: template.keyRequired must be true or false`);
  } else {
    if (typeof template.command !== "string" || !template.command.trim() || /\s/.test(template.command)) found.push(`${where}: template.command must be the program name, without arguments`);
    found.push(...lineProblems(where, "args", template.args ?? []));
    found.push(...lineProblems(where, "planArgs", template.planArgs ?? []));
    if (typeof (template.edits ?? false) !== "boolean") found.push(`${where}: template.edits must be true or false`);
    if (template.edits === true && (template.planArgs ?? []).length === 0) found.push(`${where}: a template that writes to the project needs planArgs that do not`);
  }
  return found;
}

/** Tudo que está errado num manifesto. `folder` é o nome da pasta, que tem
 * de ser o id. */
export function manifestProblems(manifest, folder, engines) {
  const where = `mods/${folder}/mod.json`;
  if (!isObject(manifest)) return [`${where}: must be a JSON object`];
  const found = [];
  for (const key of Object.keys(manifest)) if (!FIELDS.includes(key)) found.push(`${where}: ${key} is not a field of a mod`);
  const { id, kind } = manifest;
  if (id !== folder) found.push(`${where}: id must be the folder name (${folder})`);
  if (!KINDS.includes(kind)) return [...found, `${where}: kind must be one of ${KINDS.join(", ")}`];
  if (kind === "template") {
    if (typeof id !== "string" || !TEMPLATE_ID.test(id) || id.length > TEMPLATE_ID_MAX) found.push(`${where}: a template id is lowercase letters, digits and -, up to ${TEMPLATE_ID_MAX} characters`);
    if (engines.llm.includes(id) || engines.feature.includes(id)) found.push(`${where}: ${id} is the id of an engine of the app`);
    found.push(...templateProblems(where, manifest.template));
  } else {
    if (typeof id !== "string" || !ENGINE_ID.test(id)) found.push(`${where}: invalid id`);
    else if (!engines[kind].includes(id)) found.push(`${where}: ${id} is not a ${kind} engine of the app (engines.json)`);
    if ("template" in manifest) found.push(`${where}: only a template mod has template`);
  }
  if (!CATEGORIES.includes(manifest.category)) found.push(`${where}: category must be one of ${CATEGORIES.join(", ")}`);
  if (manifest.plan !== null && (typeof manifest.plan !== "string" || !PLAN.test(manifest.plan))) found.push(`${where}: plan must be a plan feature key or null`);
  if (kind === "feature") {
    if (typeof manifest.defaultOn !== "boolean") found.push(`${where}: a feature mod says defaultOn (true or false)`);
  } else if ("defaultOn" in manifest) {
    found.push(`${where}: only a feature mod has defaultOn`);
  }
  if (typeof manifest.minApp !== "string" || !VERSION.test(manifest.minApp)) found.push(`${where}: minApp must be a version like 0.94.0`);
  if ("docs" in manifest && (typeof manifest.docs !== "string" || !DOCS.test(manifest.docs))) found.push(`${where}: docs must be the id of a page of the manual`);
  if ("homepage" in manifest && (typeof manifest.homepage !== "string" || !/^https:\/\/[^\s/@]+/i.test(manifest.homepage))) found.push(`${where}: homepage must be an https address`);
  found.push(...textProblems(where, "title", manifest.title, TITLE_MAX));
  found.push(...textProblems(where, "summary", manifest.summary, SUMMARY_MAX));
  return found;
}

/** O manifesto como vai no catálogo: sem o `$schema` e com os campos na
 * ordem de sempre, para o catálogo só mudar quando um mod muda. */
function entry(manifest) {
  const out = {};
  for (const key of FIELDS) if (key !== "$schema" && key in manifest) out[key] = manifest[key];
  return out;
}

const ORDER = (engines) => (a, b) => {
  const kind = KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind);
  if (kind) return kind;
  if (a.kind === "template") return a.id.localeCompare(b.id);
  return engines[a.kind].indexOf(a.id) - engines[b.kind].indexOf(b.id);
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

/** Lê e confere todos os mods. Devolve o catálogo e o que está errado. */
export function buildCatalog(root) {
  const { engines, problems } = readEngines(root);
  if (problems.length) return { catalog: null, problems };
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
  // Todo motor tem o seu mod, a não ser que a retirada seja de propósito.
  for (const kind of ["llm", "feature"]) {
    for (const id of engines[kind]) {
      const has = mods.some((mod) => mod.kind === kind && mod.id === id);
      if (!has && !engines.withdrawn.includes(id) && !folders.includes(id)) found.push(`engine ${id} has no mod in mods/; to withdraw it from everyone, list it in engines.json withdrawn`);
    }
  }
  for (const id of engines.withdrawn) if (folders.includes(id)) found.push(`engines.json: ${id} is withdrawn but mods/${id} still exists`);
  mods.sort(ORDER(engines));
  return { catalog: found.length ? null : { schema: SCHEMA, mods }, problems: found };
}

export const serialize = (catalog) => `${JSON.stringify(catalog, null, 2)}\n`;

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const command = process.argv[2];
  if (command !== "check" && command !== "build") {
    console.error("usage: node scripts/catalog.mjs check|build");
    process.exit(2);
  }
  const { catalog, problems } = buildCatalog(root);
  if (problems.length) {
    for (const problem of problems) console.error(`✗ ${problem}`);
    process.exit(1);
  }
  const target = join(root, "catalog.json");
  const text = serialize(catalog);
  if (command === "build") {
    writeFileSync(target, text);
    console.log(`catalog.json: ${catalog.mods.length} mods`);
    return;
  }
  const current = existsSync(target) ? readFileSync(target, "utf8") : "";
  if (current !== text) {
    console.error("✗ catalog.json is out of date: run node scripts/catalog.mjs build and commit it");
    process.exit(1);
  }
  console.log(`catalog.json: ok, ${catalog.mods.length} mods`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
