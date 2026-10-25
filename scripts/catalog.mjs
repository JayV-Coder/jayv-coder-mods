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
//   pages.json       a página de cada mod no site (`mods/<id>/page.json`): o
//                    que ele faz, o que mais pede para funcionar e como usar,
//                    nos dez idiomas, com os prints de `mods/<id>/media/`.
//
//   node scripts/catalog.mjs check   confere os manifestos, as páginas e se os arquivos estão em dia
//   node scripts/catalog.mjs build   confere e grava os dois catálogos e as páginas
//
// Sem dependências: roda com o Node puro, no Actions e na máquina de quem edita.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** A versão do formato do catálogo genérico. O app e o site ignoram um
 * catálogo de formato que não conhecem e ficam com o último que entenderam. */
export const SCHEMA = 2;
/** O formato antigo, que o `catalog.json` continua seguindo. */
export const LEGACY_SCHEMA = 1;
/** O formato das páginas (`pages.json`). */
export const PAGES_SCHEMA = 1;

/** Os idiomas do app (`public.locales`): todo texto de mod vem nos dez. */
export const LOCALES = ["en", "pt-BR", "es", "zh-CN", "hi", "ar", "fr", "ru", "ja", "de"];

/** As categorias do manual do app (`docs/manual/index.json`). */
export const CATEGORIES = ["start", "chat", "agents", "gate", "privacy", "project", "team", "account", "app"];

/** A ordem dos campos no manifesto e no catálogo; um campo fora daqui é erro
 * de digitação. */
const FIELDS = ["$schema", "id", "version", "category", "plan", "minApp", "preinstalled", "required", "requires", "author", "docs", "homepage", "icon", "title", "summary", "contributes"];
/** A ordem dos campos do formato antigo. */
const LEGACY_FIELDS = ["id", "kind", "category", "plan", "defaultOn", "minApp", "docs", "homepage", "title", "summary", "template"];
const AGENT_FIELDS = {
  api: ["kind", "protocol", "baseUrl", "keyRequired", "modelField", "models"],
  cli: ["kind", "command", "args", "planArgs", "edits", "models"],
  acp: ["kind", "command", "args", "env", "buildMode", "planMode", "models"],
};
/** Os protocolos dos agentes de API: chat da OpenAI, mensagens da Anthropic
 * e, a partir do app 0.108, Responses da OpenAI e tarefas da Manus. */
const PROTOCOLS = ["openai", "anthropic", "responses", "manus"];
/** A versão do app que lê os agentes ACP, os protocolos `responses` e
 * `manus`, o `modelField` e o `{prompt_file}`. */
export const AGENTS_V2_SINCE = "0.108.0";
/** As variáveis que mudam como qualquer programa abre: o agente ACP não as
 * troca (`mods::custom` no app). */
const RESERVED_ENV = ["PATH", "HOME", "USERPROFILE", "LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH", "NODE_OPTIONS"];
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const MODE = /^[A-Za-z0-9_.:-]{1,64}$/;
const MODEL_FIELD = /^[a-z_]{1,32}$/;
const MAX_ENV = 16;
const MAX_ENV_VALUE = 4000;

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
/** As skills que um mod traz: o nome vira a skill no app (o Jev a escolhe pelo
 * pedido) e a descrição é o que o Jev lê — ele vê até 400 caracteres dela. */
const MAX_SKILLS = 4;
const SKILL_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const SKILL_DESCRIPTION_MAX = 400;
const SKILL_INSTRUCTIONS_MAX = 16_000;
const SKILL_FIELDS = ["name", "description", "instructions", "file", "mcpServers"];
const MAX_SERVERS = 4;
const SERVER_NAME = /^[A-Za-z0-9_-]{1,40}$/;
const SERVER_FIELDS = ["name", "transport", "command", "args", "env", "url", "headers"];
const ENV_KEY = /^[A-Za-z0-9_]+$/;
const SKILL_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.md$/;
/** O ícone do mod: um SVG da pasta dele, que o build põe no catálogo como
 * texto. O app e o site o mostram como imagem (`<img>` ou máscara), nunca
 * dentro da página, então nada nele roda; mesmo assim só passa o desenho. */
const ICON_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.svg$/;
const ICON_MAX_BYTES = 16_000;
const ICON_ELEMENTS = new Set(["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "defs", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "title", "desc", "image", "use", "symbol"]);

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
 * `{model}` (em qualquer parte) e `{prompt}` ou `{prompt_file}` (sozinhos
 * num argumento). O agente ACP recebe o pedido pelo protocolo: na linha dele,
 * só `{model}`. */
function lineProblems(label, args, acp = false) {
  if (!Array.isArray(args)) return [`${label} must be a list of arguments`];
  if (args.length > MAX_ARGS) return [`${label} takes at most ${MAX_ARGS} arguments`];
  const found = [];
  for (const arg of args) {
    // eslint-disable-next-line no-control-regex
    if (typeof arg !== "string" || arg === "" || arg.length > MAX_ARG || /[\u0000-\u001f\u007f]/.test(arg)) {
      found.push(`${label} has an empty, multi-line or too long argument`);
      continue;
    }
    const rest = !acp && (arg === "{prompt}" || arg === "{prompt_file}") ? "" : arg.replaceAll("{model}", "");
    for (const token of rest.match(PLACEHOLDER) ?? []) found.push(acp ? `${label} uses ${token}; an ACP agent gets the request through the protocol, so only {model} is accepted` : `${label} uses ${token}; only {model}, {prompt} and {prompt_file} (alone in an argument) are accepted`);
  }
  return found;
}

/** O agente usa o que só o app 0.108 lê: ACP, `responses`, `manus`,
 * `modelField` ou `{prompt_file}`. */
export function needsAgentsV2(agent) {
  if (!isObject(agent)) return false;
  const lines = [...(agent.args ?? []), ...(agent.planArgs ?? [])];
  return agent.kind === "acp" || ["responses", "manus"].includes(agent.protocol) || agent.modelField !== undefined || lines.includes("{prompt_file}");
}

/** As variáveis de um agente ACP: nomes de variável, valores sem quebra de
 * linha, nenhuma das reservadas. */
function envProblems(where, env) {
  if (env === undefined) return [];
  if (!isObject(env) || Object.keys(env).length > MAX_ENV) return [`${where}.env must be an object with up to ${MAX_ENV} variables`];
  const found = [];
  for (const [name, value] of Object.entries(env)) {
    const reserved = RESERVED_ENV.includes(name.toUpperCase()) || name.toUpperCase().startsWith("DYLD_");
    // eslint-disable-next-line no-control-regex
    if (!ENV_NAME.test(name) || reserved || typeof value !== "string" || value.length > MAX_ENV_VALUE || /[\u0000-\u001f\u007f]/.test(value)) found.push(`${where}.env.${name} is not a variable the app accepts`);
  }
  return found;
}

/** Um agente de linha de comando, ACP ou de API: a definição de um mod
 * criado, sem o que é da máquina (a chave, a aprovação dos servidores MCP). */
function agentProblems(where, agent) {
  if (!isObject(agent)) return [`${where} must be an object`];
  const fields = AGENT_FIELDS[agent.kind];
  if (!fields) return [`${where}.kind must be api, cli or acp`];
  const found = [];
  for (const key of Object.keys(agent)) if (!fields.includes(key)) found.push(`${where}.${key} is not a field of a ${agent.kind} agent`);
  const models = agent.models ?? [];
  if (!Array.isArray(models) || models.length > MAX_MODELS || models.some((model) => typeof model !== "string" || !MODEL.test(model))) {
    found.push(`${where}.models must be a list of up to ${MAX_MODELS} model ids`);
  } else if (new Set(models).size !== models.length) {
    found.push(`${where}.models repeats a model`);
  }
  if (agent.kind === "api") {
    if (!PROTOCOLS.includes(agent.protocol)) found.push(`${where}.protocol must be one of ${PROTOCOLS.join(", ")}`);
    if (typeof agent.baseUrl !== "string" || !/^https?:\/\/[^\s/@]+/i.test(agent.baseUrl)) found.push(`${where}.baseUrl must be an http(s) address`);
    if (typeof agent.keyRequired !== "boolean") found.push(`${where}.keyRequired must be true or false`);
    if (agent.modelField !== undefined && (agent.protocol !== "responses" || typeof agent.modelField !== "string" || !MODEL_FIELD.test(agent.modelField))) found.push(`${where}.modelField is only for the responses protocol: lowercase letters and _`);
  } else if (agent.kind === "acp") {
    if (typeof agent.command !== "string" || !agent.command.trim() || /\s/.test(agent.command)) found.push(`${where}.command must be the program name, without arguments`);
    found.push(...lineProblems(`${where}.args`, agent.args ?? [], true));
    found.push(...envProblems(where, agent.env));
    for (const field of ["buildMode", "planMode"]) if (agent[field] !== undefined && (typeof agent[field] !== "string" || !MODE.test(agent[field]))) found.push(`${where}.${field} must be the id of a mode the agent offers`);
  } else {
    if (typeof agent.command !== "string" || !agent.command.trim() || /\s/.test(agent.command)) found.push(`${where}.command must be the program name, without arguments`);
    found.push(...lineProblems(`${where}.args`, agent.args ?? []));
    found.push(...lineProblems(`${where}.planArgs`, agent.planArgs ?? []));
    if (typeof (agent.edits ?? false) !== "boolean") found.push(`${where}.edits must be true or false`);
    if (agent.edits === true && (agent.planArgs ?? []).length === 0) found.push(`${where}: an agent that writes to the project needs planArgs that do not`);
  }
  return found;
}

/** Um servidor MCP de uma skill, como a tela de MCP do app o aceita: `stdio`
 * (um programa, sem argumentos no nome) ou `http` (um endereço). */
function serverProblems(where, server) {
  if (!isObject(server)) return [`${where} must be an object`];
  const found = [];
  for (const key of Object.keys(server)) if (!SERVER_FIELDS.includes(key)) found.push(`${where}.${key} is not a field of an MCP server`);
  if (typeof server.name !== "string" || !SERVER_NAME.test(server.name) || server.name === "jayv") found.push(`${where}.name must be letters, digits, - and _ (not jayv)`);
  const transport = server.transport ?? "stdio";
  if (transport === "stdio") {
    if (typeof server.command !== "string" || !server.command.trim() || /\s/.test(server.command)) found.push(`${where}.command must be the program name, without arguments`);
    if (!Array.isArray(server.args ?? []) || (server.args ?? []).some((arg) => typeof arg !== "string" || arg === "")) found.push(`${where}.args must be a list of arguments`);
    if (!isObject(server.env ?? {}) || Object.entries(server.env ?? {}).some(([key, value]) => !ENV_KEY.test(key) || typeof value !== "string")) found.push(`${where}.env must map variable names to text`);
    if ("url" in server || "headers" in server) found.push(`${where}: a stdio server has no url or headers`);
  } else if (transport === "http") {
    if (typeof server.url !== "string" || !/^https?:\/\/[^\s/@]+/i.test(server.url)) found.push(`${where}.url must be an http(s) address`);
    if (!isObject(server.headers ?? {}) || Object.values(server.headers ?? {}).some((value) => typeof value !== "string")) found.push(`${where}.headers must map header names to text`);
    if ("command" in server || "args" in server || "env" in server) found.push(`${where}: an http server has no command, args or env`);
  } else found.push(`${where}.transport must be stdio or http`);
  return found;
}

/** Uma skill de mod: o nome, quando usá-la (em inglês, para o Jev) e as
 * instruções (em inglês, para o modelo) — no próprio manifesto ou num `.md` da
 * pasta do mod (`file`), que o build põe no catálogo. */
function skillProblems(where, skill, folder) {
  if (!isObject(skill)) return [`${where} must be an object`];
  const found = [];
  for (const key of Object.keys(skill)) if (!SKILL_FIELDS.includes(key)) found.push(`${where}.${key} is not a field of a skill`);
  if (typeof skill.name !== "string" || !SKILL_NAME.test(skill.name)) found.push(`${where}.name must be letters, digits, - and _, up to 64`);
  if (!isText(skill.description) || skill.description.length > SKILL_DESCRIPTION_MAX) found.push(`${where}.description must say when to use the skill, up to ${SKILL_DESCRIPTION_MAX} characters (Jev reads that much)`);
  if (("instructions" in skill) === ("file" in skill)) found.push(`${where} needs either instructions or file`);
  else if ("file" in skill) {
    if (typeof skill.file !== "string" || !SKILL_FILE.test(skill.file)) found.push(`${where}.file must be a .md file in the folder of the mod`);
    else if (folder && !existsSync(join(folder, skill.file))) found.push(`${where}.file: ${skill.file} is not in the folder of the mod`);
    else if (folder && readFileSync(join(folder, skill.file), "utf8").trim().length > SKILL_INSTRUCTIONS_MAX) found.push(`${where}.file is longer than ${SKILL_INSTRUCTIONS_MAX} characters`);
  } else if (!isText(skill.instructions) || skill.instructions.length > SKILL_INSTRUCTIONS_MAX) found.push(`${where}.instructions must be the instructions, up to ${SKILL_INSTRUCTIONS_MAX} characters`);
  const servers = skill.mcpServers ?? [];
  if (!Array.isArray(servers) || servers.length > MAX_SERVERS) found.push(`${where}.mcpServers must be a list of up to ${MAX_SERVERS} servers`);
  else {
    servers.forEach((server, index) => found.push(...serverProblems(`${where}.mcpServers[${index}]`, server)));
    const names = servers.map((server) => server?.name);
    if (new Set(names).size !== names.length) found.push(`${where}.mcpServers repeats a server name`);
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
 * - `skills`     instala skills que o Jev escolhe pelo pedido; os servidores MCP
 *                de cada uma só vão ao agente no pedido em que ela vale.
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
    problems: (where, value, { id, minApp }) => {
      if (!Array.isArray(value) || value.length === 0 || value.length > MAX_AGENTS) return [`${where} must be a list of 1 to ${MAX_AGENTS} agents`];
      const found = [];
      if (typeof id !== "string" || !AGENT_MOD_ID.test(id) || id.length > AGENT_MOD_ID_MAX) found.push(`${where}: a mod with agents has an id of lowercase letters, digits and -, up to ${AGENT_MOD_ID_MAX} characters`);
      value.forEach((agent, index) => {
        found.push(...agentProblems(`${where}[${index}]`, agent));
        if (needsAgentsV2(agent) && minApp && compareVersions(minApp, AGENTS_V2_SINCE) < 0) found.push(`${where}[${index}] needs minApp ${AGENTS_V2_SINCE} or newer (ACP, the responses and manus protocols, modelField and {prompt_file} are read from that version on)`);
      });
      return found;
    },
    engines: () => [],
    // O formato antigo só diz um agente que o app 0.94 lê.
    legacy: (_mod, value) => (value.length === 1 && !needsAgentsV2(value[0]) ? { kind: "template", template: value[0] } : null),
  },
  skills: {
    since: "0.103.0",
    problems: (where, value, { folder }) => {
      if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SKILLS) return [`${where} must be a list of 1 to ${MAX_SKILLS} skills`];
      const found = [];
      value.forEach((skill, index) => found.push(...skillProblems(`${where}[${index}]`, skill, folder)));
      const names = value.map((skill) => skill?.name);
      if (new Set(names).size !== names.length) found.push(`${where} repeats a skill name`);
      return found;
    },
    engines: () => [],
    // O app antigo não tem skills de mod.
    legacy: () => null,
  },
};

/** A ordem em que os pontos aparecem (e a ordem dos mods no catálogo). */
const POINT_ORDER = ["llmEngines", "features", "agents", "skills"];

/** O que está errado no SVG de um ícone: só o desenho (os elementos de
 * `ICON_ELEMENTS`), com `viewBox`, sem script, estilo, evento ou endereço de
 * fora — uma imagem embutida só em `data:` PNG, JPEG ou WebP. */
export function iconProblems(where, text) {
  const found = [];
  if (Buffer.byteLength(text, "utf8") > ICON_MAX_BYTES) found.push(`${where} is larger than ${ICON_MAX_BYTES / 1000} kB`);
  const body = text.replace(/<!--[\s\S]*?-->/g, "").replace(/<\?xml[^>]*\?>/, "").trim();
  if (!/^<svg\b[^>]*>[\s\S]*<\/svg>$/.test(body)) return [...found, `${where} must be one <svg> element`];
  if (!/^<svg\b[^>]*\sviewBox="[^"]+"/.test(body)) found.push(`${where}: the <svg> needs a viewBox`);
  if (/<!|<\?|\son[a-z]+\s*=|javascript:|@import/i.test(body)) found.push(`${where} has a script, an event or a declaration: only the drawing goes in an icon`);
  for (const [, name] of body.matchAll(/<([A-Za-z][\w:-]*)/g)) if (!ICON_ELEMENTS.has(name)) found.push(`${where}: <${name}> is not allowed in an icon`);
  for (const [, value] of body.matchAll(/\s(?:xlink:)?href\s*=\s*"([^"]*)"/g)) {
    if (!value.startsWith("#") && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) found.push(`${where}: href may only point inside the icon or to a data: image`);
  }
  for (const [, value] of body.matchAll(/url\(\s*([^)]*)\)/g)) if (!value.trim().startsWith("#")) found.push(`${where}: url() may only point inside the icon`);
  return [...new Set(found)];
}

/** O SVG como vai no catálogo: sem comentários nem a declaração XML, sem
 * `class`, `width` e `height` (quem mostra decide o tamanho) e sem as quebras
 * de linha entre as tags. */
export function cleanIcon(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\?xml[^>]*\?>/, "")
    .replace(/<svg\b[^>]*>/, (open) => open.replace(/\s(class|width|height)="[^"]*"/g, "").replace(/\s+/g, " ").replace(/\s>$/, ">"))
    .replace(/>\s+</g, "><")
    .replace(/\s+\/>/g, "/>")
    .trim();
}

/** Tudo que está errado num manifesto, sozinho. `folder` é o nome da pasta,
 * que tem de ser o id. As dependências (`requires`) são conferidas com o
 * catálogo inteiro, em `buildCatalog`. */
export function manifestProblems(manifest, folder, engines, dir = null) {
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
  if (typeof manifest.icon !== "string" || !ICON_FILE.test(manifest.icon)) found.push(`${where}: icon must be an .svg file in the folder of the mod (every mod has an icon)`);
  else if (dir && !existsSync(join(dir, manifest.icon))) found.push(`${where}: icon: ${manifest.icon} is not in the folder of the mod`);
  else if (dir) found.push(...iconProblems(`mods/${folder}/${manifest.icon}`, readFileSync(join(dir, manifest.icon), "utf8")));
  found.push(...textProblems(where, "title", manifest.title, TITLE_MAX));
  found.push(...textProblems(where, "summary", manifest.summary, SUMMARY_MAX));

  const contributes = manifest.contributes;
  if (!isObject(contributes) || Object.keys(contributes).length === 0) return [...found, `${where}: contributes must say what the mod adds to at least one extension point (${POINT_ORDER.join(", ")})`];
  for (const [key, value] of Object.entries(contributes)) {
    const point = POINTS[key];
    if (!point) { found.push(`${where}: contributes.${key} is not an extension point of the app (${POINT_ORDER.join(", ")})`); continue; }
    found.push(...point.problems(`${where}: contributes.${key}`, value, { engines, id, folder: dir, minApp }));
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
 * na ordem de sempre, para o catálogo só mudar quando um mod muda. As
 * instruções de uma skill que moram num `.md` entram no catálogo como texto. */
function entry(manifest, dir = null) {
  const out = {};
  for (const key of FIELDS) if (key !== "$schema" && key in manifest) out[key] = manifest[key];
  // O nome do arquivo vira o desenho: quem lê o catálogo não lê a pasta.
  if (dir && typeof manifest.icon === "string") out.icon = cleanIcon(readFileSync(join(dir, manifest.icon), "utf8"));
  const contributes = {};
  for (const key of POINT_ORDER) if (key in manifest.contributes) contributes[key] = manifest.contributes[key];
  if (contributes.skills) {
    contributes.skills = contributes.skills.map((skill) => {
      const instructions = "file" in skill ? readFileSync(join(dir, skill.file), "utf8").trim() : skill.instructions;
      const shaped = { name: skill.name, description: skill.description, instructions };
      if (skill.mcpServers?.length) shaped.mcpServers = skill.mcpServers;
      return shaped;
    });
  }
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

/** A página de cada mod no site (`mods/<id>/page.json`). Os textos vêm nos
 * dez idiomas; os prints moram em `mods/<id>/media/<nome>.<idioma>.webp`, com
 * o inglês obrigatório (o idioma sem print mostra o inglês). O print
 * `enable` (a aba Mods com o mod) acompanha os passos de habilitar, que o site
 * escreve igual para todo mod. */
const PAGE_FIELDS = ["$schema", "about", "requirements", "setup", "use"];
const STEP_FIELDS = ["text", "image"];
const ABOUT_MAX = 1200;
const STEP_MAX = 600;
const MAX_STEPS = 6;
const IMAGE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ENABLE_IMAGE = "enable";
const MEDIA = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.([A-Za-z-]+)\.webp$/;
const MEDIA_MAX_BYTES = 600_000;

/** Os prints da pasta do mod: nome → idiomas que ele tem, e os problemas dos
 * arquivos (nome fora do padrão, idioma que o app não tem, grande demais). */
function mediaOf(dir, where) {
  const media = join(dir, "media");
  const images = new Map();
  const found = [];
  if (!existsSync(media)) return { images, problems: found };
  for (const file of readdirSync(media).sort()) {
    const match = MEDIA.exec(file);
    if (!match || !LOCALES.includes(match[2])) { found.push(`${where}/media/${file}: name it <image>.<locale>.webp, with a locale of the app`); continue; }
    if (statSync(join(media, file)).size > MEDIA_MAX_BYTES) found.push(`${where}/media/${file} is larger than ${MEDIA_MAX_BYTES / 1000} kB`);
    const list = images.get(match[1]) ?? [];
    list.push(match[2]);
    images.set(match[1], list);
  }
  return { images, problems: found };
}

/** O print como vai em `pages.json`: o nome, os idiomas (na ordem do app) e
 * uma marca do conteúdo, para o cache de quem vê trocar junto com o print. */
function imageEntry(dir, name, locales) {
  const ordered = LOCALES.filter((locale) => locales.includes(locale));
  const hash = createHash("sha256");
  for (const locale of ordered) hash.update(readFileSync(join(dir, "media", `${name}.${locale}.webp`)));
  return { name, locales: ordered, v: hash.digest("hex").slice(0, 10) };
}

/** Tudo que está errado na página de um mod. */
export function pageProblems(page, folder, images) {
  const where = `mods/${folder}/page.json`;
  if (!isObject(page)) return [`${where}: must be a JSON object`];
  const found = [];
  for (const key of Object.keys(page)) if (!PAGE_FIELDS.includes(key)) found.push(`${where}: ${key} is not a field of a page`);
  found.push(...textProblems(where, "about", page.about, ABOUT_MAX));
  if ("requirements" in page) found.push(...textProblems(where, "requirements", page.requirements, STEP_MAX));
  const used = new Set();
  const steps = (field, min) => {
    const list = page[field] ?? [];
    if (!Array.isArray(list) || list.length < min || list.length > MAX_STEPS) { found.push(`${where}: ${field} must be a list of ${min} to ${MAX_STEPS} steps`); return; }
    list.forEach((step, index) => {
      const at = `${field}[${index}]`;
      if (!isObject(step)) { found.push(`${where}: ${at} must be an object`); return; }
      for (const key of Object.keys(step)) if (!STEP_FIELDS.includes(key)) found.push(`${where}: ${at}.${key} is not a field of a step`);
      found.push(...textProblems(where, `${at}.text`, step.text, STEP_MAX));
      if ("image" in step) {
        if (typeof step.image !== "string" || !IMAGE.test(step.image) || step.image === ENABLE_IMAGE) found.push(`${where}: ${at}.image must be the name of a print in media/ (not ${ENABLE_IMAGE})`);
        else if (!images.get(step.image)?.includes("en")) found.push(`${where}: ${at}.image needs media/${step.image}.en.webp`);
        else used.add(step.image);
      }
    });
  };
  steps("setup", 0);
  steps("use", 1);
  if (images.has(ENABLE_IMAGE) && !images.get(ENABLE_IMAGE).includes("en")) found.push(`mods/${folder}/media: the ${ENABLE_IMAGE} print needs ${ENABLE_IMAGE}.en.webp`);
  for (const name of images.keys()) if (name !== ENABLE_IMAGE && !used.has(name)) found.push(`mods/${folder}/media: ${name} is not used by any step of page.json`);
  return found;
}

/** As páginas de todos os mods do catálogo, conferidas: todo mod tem a sua. */
export function buildPages(root, mods) {
  const found = [];
  const pages = {};
  for (const mod of mods) {
    const dir = join(root, "mods", mod.id);
    const where = `mods/${mod.id}`;
    const file = join(dir, "page.json");
    if (!existsSync(file)) { found.push(`${where}: missing page.json (every mod has a page on the site)`); continue; }
    let page;
    try {
      page = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      found.push(`${where}/page.json: invalid JSON (${error.message})`);
      continue;
    }
    const { images, problems: media } = mediaOf(dir, where);
    const problems = [...media, ...pageProblems(page, mod.id, images)];
    if (problems.length) { found.push(...problems); continue; }
    const step = (item) => (item.image ? { text: item.text, image: imageEntry(dir, item.image, images.get(item.image)) } : { text: item.text });
    pages[mod.id] = {
      version: mod.version,
      about: page.about,
      ...(page.requirements ? { requirements: page.requirements } : {}),
      enable: images.has(ENABLE_IMAGE) ? imageEntry(dir, ENABLE_IMAGE, images.get(ENABLE_IMAGE)) : null,
      setup: (page.setup ?? []).map(step),
      use: page.use.map(step),
    };
  }
  return { pages: found.length ? null : { schema: PAGES_SCHEMA, pages }, problems: found };
}

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
  if (problems.length) return { catalog: null, legacy: null, pages: null, problems };
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
    const dir = join(root, "mods", folder);
    const problems = manifestProblems(manifest, folder, engines, dir);
    if (problems.length) found.push(...problems);
    else mods.push(entry(manifest, dir));
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
  // Duas skills com o mesmo nome: o app fica com a do primeiro mod instalado.
  const skills = new Map();
  for (const mod of mods) {
    for (const skill of mod.contributes.skills ?? []) {
      if (skills.has(skill.name)) found.push(`mods/${mod.id}/mod.json: skill ${skill.name} is also a skill of mods/${skills.get(skill.name)}`);
      else skills.set(skill.name, mod.id);
    }
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
  const { pages, problems: pageProblemsFound } = buildPages(root, mods);
  found.push(...pageProblemsFound);
  if (found.length) return { catalog: null, legacy: null, pages: null, problems: found };
  mods.sort(ORDER(engines));
  legacy.sort(LEGACY_ORDER(engines));
  return { catalog: { schema: SCHEMA, mods }, legacy: { schema: LEGACY_SCHEMA, mods: legacy }, pages, problems: [] };
}

export const serialize = (catalog) => `${JSON.stringify(catalog, null, 2)}\n`;

/** Os arquivos que o build grava, com o conteúdo de cada um. */
export const outputs = ({ catalog, legacy, pages }) => [["catalog.v2.json", serialize(catalog)], ["catalog.json", serialize(legacy)], ["pages.json", serialize(pages)]];

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
    console.log(`catalog.v2.json: ${built.catalog.mods.length} mods; catalog.json: ${built.legacy.mods.length} mods; pages.json: ${Object.keys(built.pages.pages).length} pages`);
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
  console.log(`catalog.v2.json: ok, ${built.catalog.mods.length} mods; catalog.json: ok, ${built.legacy.mods.length} mods; pages.json: ok, ${Object.keys(built.pages.pages).length} pages`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
