# JayV mods

Every mod of [JayV](https://github.com/JayV-Coder/jayv-coder) lives here, one
folder per mod: `mods/<id>/mod.json`. The app and the site download the
catalog through the `mods` function of JayV's Supabase; they never read GitHub
directly.

Mods work like game mods: each one is a package with a name, a version and an
author, and people install, switch on, switch off and uninstall them in
Settings › Mods (or on the site, Dashboard › Mods), per environment. A mod is
not tied to any one subject: it says, in `contributes`, what it adds to each
**extension point** of the app, and one mod can add to several.

| extension point | what a mod adds |
| --- | --- |
| `llmEngines` | LLM integration engines of the app (Claude Code, Codex, GitHub Copilot, Cursor, Kilo Code, OpenRouter, LiteLLM) |
| `features` | Optional features of the app (statistics, gatehouse board, MCP, skills…); the plan still applies |
| `agents` | Command-line programs, ACP agents or APIs (OpenAI, Anthropic, OpenAI Responses, Manus tasks), installed as the person's own agents (Ollama, LM Studio, Gemini CLI, DeepSeek, Aider…) |
| `skills` | Skills Jev picks by the request, with the MCP servers each one needs; the servers reach the agent only in the request where the skill applies (REA, for reverse engineering) |

A mod is a manifest, not code: the app's core is compiled into the installer
and runs nothing it downloads. New extension points arrive with new versions of
the app; mods that use a point an app does not know are skipped by that app.

Mods people create for themselves are made on the site (Dashboard › Mods) and
stay in their account; they are not part of this repository.

## Adding or changing a mod

1. Edit or create `mods/<id>/mod.json` (the `$schema` line gives your editor
   completion from `schema/mod.schema.json`). Titles and summaries come in the
   ten languages of the app.
2. Write its page in `mods/<id>/page.json` (`schema/page.schema.json`): what
   it does, what else it needs, the setup steps and how to use it, in the ten
   languages. Screenshots go in `mods/<id>/media/<name>.<locale>.webp` and a
   step points at one with `image`; they come from the app's real screens,
   made by `node tools/mod-shots/shoot.mjs --only <id>` in the app repository.
   Each mod's page is on the site at `/mods/<id>`.
3. Run `node scripts/catalog.mjs build` and commit `catalog.v2.json`,
   `catalog.json` and `pages.json` with it.
4. Open a pull request: the workflow runs the validator tests and
   `node scripts/catalog.mjs check`.

`catalog.v2.json` is the generic format the app reads since 0.95.0;
`catalog.json` is the older format, derived from it, kept for older apps.

## Example

```json
{
  "$schema": "../../schema/mod.schema.json",
  "id": "local-pack",
  "version": "1.0.0",
  "category": "agents",
  "plan": "customMods",
  "minApp": "0.94.0",
  "preinstalled": false,
  "requires": ["mcp"],
  "author": "Someone",
  "icon": "icon.svg",
  "title": { "en": "Local pack", "pt-BR": "Pacote local", "...": "..." },
  "summary": { "en": "A local model and the features it needs.", "...": "..." },
  "contributes": {
    "features": ["projectNotes"],
    "agents": [
      {
        "kind": "api",
        "protocol": "openai",
        "baseUrl": "http://localhost:8080/v1",
        "keyRequired": false,
        "models": []
      }
    ]
  }
}
```

- `required`: essential — JayV needs it. Always installed and on; nobody
  turns it off or uninstalls it (the plan still applies to what it brings).
  Implies `preinstalled`. The app's features are required; the LLM engines
  and the agents are not.
- `preinstalled`: installed, and on, when the person signs in. If they
  uninstall it, it does not come back. Only the essential mods are; the LLM
  engines, the agents and the skills wait for whoever wants them.
- `icon`: an `.svg` file in the mod's folder, required. Only the drawing (no
  script, style, event or outside address; an embedded image only as a
  `data:` PNG, JPEG or WebP), up to 16 kB, with a `viewBox`. A one-color icon
  uses `currentColor` and follows the text color and the theme; a colored one
  keeps its colors. The build puts the drawing in the catalog.
- `requires`: mods this one needs installed and on; installing it brings them.
- A command-line agent uses `"kind": "cli"` with `command`, `args` (where
  `{model}` becomes the model Jev picked and `{prompt}`, alone in an argument,
  the request), `planArgs` and `edits`. From app 0.107, `{prompt_file}`, alone
  in an argument, becomes the path of a file with the request, for programs
  that read it from a file (`mods/aider`).
- An ACP agent (`"kind": "acp"`, app 0.107+) is a program the app talks to
  through the [Agent Client Protocol](https://agentclientprotocol.com) over
  stdio: `command`, the `args` that start its ACP server, optional `env`, and
  `buildMode` / `planMode`, the agent's own modes for Development and
  Planning. The app picks the model, passes the MCP servers and answers each
  permission the agent asks for by the mode of the request. The model
  `default` keeps the agent's choice; the person loads the others from the
  agent (`mods/gemini`, `mods/opencode`).
- An API agent (`"kind": "api"`) uses `protocol` `openai` or `anthropic`; from
  app 0.107 also `responses` (OpenAI Responses, with `modelField` when the
  model goes in another field, as in `mods/perplexity`) and `manus` (the
  Manus task API).
- A skill (`"skills"`, app 0.103+) has a `name`, a `description` in English
  that tells Jev when to use it (up to 400 characters), its instructions in
  `instructions` or in a `.md` file of the mod's folder (`file`), and up to
  four `mcpServers`. See `mods/rea` for a complete one.
