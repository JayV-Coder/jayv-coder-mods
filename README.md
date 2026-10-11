# JayV mods

Every mod of [JayV](https://github.com/JayV-Coder/jayv-coder) lives here, one
folder per mod: `mods/<id>/mod.json`. The app and the site download
`catalog.json` through the `mods` function of JayV's Supabase; they never read
GitHub directly.

A mod is a manifest, not code:

| kind | what it does |
| --- | --- |
| `llm` | Turns on one of the app's LLM engines (Claude Code, Codex, GitHub Copilot, Cursor, Kilo Code, OpenRouter, LiteLLM). |
| `feature` | Turns on one of the app's optional features (statistics, gatehouse board, MCP, skills…). People switch it in Settings › Mods; the plan still applies. |
| `template` | A ready-made mod people install as their own: a command-line program or an API compatible with OpenAI or Anthropic (Ollama, LM Studio). |

Mods people create for themselves are made on the site (Dashboard › Mods) and
stay in their account; they are not part of this repository.

## Adding or changing a mod

1. Edit or create `mods/<id>/mod.json` (the `$schema` line gives your editor
   completion from `schema/mod.schema.json`). Titles and summaries come in the
   ten languages of the app.
2. Run `node scripts/catalog.mjs build` and commit `catalog.json` with it.
3. Open a pull request: the workflow runs the validator tests and
   `node scripts/catalog.mjs check`.

`llm` and `feature` mods can only name engines listed in `engines.json`; a new
engine arrives with a new version of the app, and its manifest sets `minApp`
to that version.

## Example: a template

```json
{
  "$schema": "../../schema/mod.schema.json",
  "id": "local-ai",
  "kind": "template",
  "category": "agents",
  "plan": "customMods",
  "minApp": "0.94.0",
  "title": { "en": "Local AI", "pt-BR": "IA local", "...": "..." },
  "summary": { "en": "Models from a local server.", "...": "..." },
  "template": {
    "kind": "api",
    "protocol": "openai",
    "baseUrl": "http://localhost:8080/v1",
    "keyRequired": false,
    "models": []
  }
}
```

A command-line template uses `"kind": "cli"` with `command`, `args` (where
`{model}` becomes the model Jev picked and `{prompt}`, alone in an argument,
the request), `planArgs` and `edits`.
