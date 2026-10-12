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
| `agents` | Command-line programs or APIs compatible with OpenAI or Anthropic, installed as the person's own agents (Ollama, LM Studio) |

A mod is a manifest, not code: the app's core is compiled into the installer
and runs nothing it downloads. New extension points arrive with new versions of
the app; mods that use a point an app does not know are skipped by that app.

Mods people create for themselves are made on the site (Dashboard › Mods) and
stay in their account; they are not part of this repository.

## Adding or changing a mod

1. Edit or create `mods/<id>/mod.json` (the `$schema` line gives your editor
   completion from `schema/mod.schema.json`). Titles and summaries come in the
   ten languages of the app.
2. Run `node scripts/catalog.mjs build` and commit `catalog.v2.json` and
   `catalog.json` with it.
3. Open a pull request: the workflow runs the validator tests and
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

- `preinstalled`: installed, and on, when the person signs in. If they
  uninstall it, it does not come back.
- `requires`: mods this one needs installed and on; installing it brings them.
- A command-line agent uses `"kind": "cli"` with `command`, `args` (where
  `{model}` becomes the model Jev picked and `{prompt}`, alone in an argument,
  the request), `planArgs` and `edits`.
