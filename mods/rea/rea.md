# Reverse engineering with REA

REA (Reverse Engineer Anything, MIT, https://rea.tools) inspects software without its source code and answers with evidence: the file, the address or function, the string, the reference that shows each fact. Use it to explain how an existing program works, to collect evidence of a behavior, or to rebuild a similar feature in the developer's project from what the program does. It never recovers the original source code and must not be used to copy it.

## Tools

- **MCP server `rea`** (tools named `mcp__rea__*` in Claude Code): connected for this request when the agent's MCP servers are approved in JayV. Prefer it.
- **Command line** when the MCP tools are not available and you can run commands: `npx -y rea-agents@6.4.0 <command> ... --format md` (or `--format json`). `npx -y rea-agents@6.4.0 doctor --format md` says what is ready on this computer.
- If neither is possible, say so, explain what REA would look at, and tell the developer how to enable it: turn on **Approve MCP servers** in the agent's tab in JayV's Settings (Node.js 22.19 or newer is needed for `npx rea-agents`).

## How to investigate

1. **Pin the target.** Get the exact path of the app, executable, library, package (`.app`, `.exe`, `.dll`, `.so`, `.dylib`, `.apk`, `.ipa`, `.asar`, an extracted folder) or the page. Ask for it when the request does not give it; never guess a path outside the project without saying so.
2. **Overview first.** `inspect_artifact` (CLI `inspect-artifact <path>`) identifies the format and suggests the next probes. Then, by kind:
   - native code: `binary_overview`, `search_strings` / `search_procedures` (CLI `analyze <path>`, `search <path> <text>`), `inspect_macho`, `inspect_signature`, `inspect_plist`, `inspect_pe_resources`, `inspect_binary_layout`;
   - JavaScript and Electron (`.asar` or app folder): `analyze_javascript_application` (CLI `analyze-javascript-application <path>`) maps modules, routes, IPC and native dependencies without running the code;
   - .NET: `inspect_managed_artifact`, `inspect_managed_members`;
   - Android: `inspect_android_package`, `search_android_classes`, `inspect_android_method`;
   - websites: the developer starts a browser with remote debugging on a loopback address (for example `--remote-debugging-port=9222`); then `list_browser_targets` and `inspect_web_page`, which observe passively.
3. **Follow the feature.** From a visible string, menu label, error message or route, use `trace_feature` (CLI `trace <path> <text>`), `xrefs`, `procedure_callers` / `procedure_callees` and `get_call_graph` to reach the code that does the work. Decompile (`analyze_function`, `procedure_pseudo_code`, CLI `function` / `decompile`) only the routines that matter, not the whole program.
4. **Runtime only when needed, and only with permission.** Process, browser or Electron captures (`capture_process_scenario`, `capture_browser_scenario`, `observe_javascript_runtime`) run the target with the developer's permissions. Ask before launching any program, and never run one the developer did not name.
5. **Native deep analysis** (decompiling machine code) needs Hopper or Ghidra 12.1 with JDK 21. Without them, say so and keep to what works without them: identification, strings, symbols, layout, signatures, resources, JavaScript, .NET metadata and Android packages.

## How to answer

- State each finding with its evidence (path, address or function, string, reference) and keep what you observed apart from what you infer; list what is still unknown.
- When the developer wants the feature in their project, write new code for the project from the observed behavior. Do not paste decompiled code or assets of the inspected program.
- Inspect only software the developer may lawfully analyze. Do not help to bypass licensing, DRM or other protections, or to pull keys, passwords or personal data out of a program.
