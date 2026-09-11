# smithcore-designer

Visual flow editor for the [smithcore](https://github.com/as-kurosss/smithcore-engine) RPA engine.

Drag nodes onto the canvas, connect them, configure tool selectors, and debug
the flow step by step — in the browser, against the local smithcore engine.

![status](https://img.shields.io/badge/status-early%20beta-orange)
![license](https://img.shields.io/badge/license-MIT-green)

## Features

- **Visual canvas** — nodes for control flow (start/end/if/loop/fail), variables
  (`set` node), subflows (`flow` node), and every registered smithcore tool;
  free-form graph editing with minimap and zoom
- **Flowchart-standard shapes** — diamonds for decisions/loops, stadium
  terminators, card-shaped tool nodes, red `err` output for error handling
- **Step debugger** — run the flow against real Windows UI: pause on nodes or
  breakpoints (right-click a node), step, inspect and edit variables from a
  REPL terminal
- **Record → flow** — click **Record**, perform the actions on the desktop
  (clicks + typed text are captured with their selectors), press **Stop**, and
  the recording lands on the canvas as a runnable flow (needs the `record`
  extra + `smithcore-engine[windows]`)
- **SheRPA-style selectors** — selector fields rendered as one XML-like string
  (`<Element name="OK" control_type="Button"/>`), editable inline or through an
  attribute modal; copy/paste selectors between blocks
- **Typed variables** — `set` node with `auto / string / number / bool / json`
  value types
- **Labels** — double-click any block to annotate it; labels persist in the
  flow file

## Install

```bash
pip install smithcore-designer
```

Requires Python 3.11+. For Windows UI-automation tools install the engine with
its `windows` extra: `pip install "smithcore-engine[windows]"`. For **Record →
flow** also install the recorder extra: `pip install "smithcore-designer[record]"`.

## Quick start

```bash
# build the UI once (Node 18+):
cd designer-web && npm install && npm run build && cd ..

# run the designer (opens the browser):
smithcore-designer flow.json
# or:
python -m smithcore_designer flow.json
```

The server binds to `127.0.0.1:8756` and serves the prebuilt bundle from
`designer-web/dist` (or `src/smithcore_designer/static` in installed packages).

## Flow file

The flow document format is versioned — see the
[flow format contract](https://github.com/as-kurosss/smithcore-engine#flow-format-v2)
in the smithcore repo. Current version: **v2**.

## Flow project

The designer edits a **project**: one main flow plus reusable subflows. The
main file is the one you pass on the command line (``flow.json`` by default);
subflows live under ``flows/`` and show up as tabs next to it.

```
flow.json               main flow (the pack's "process" stage)
flows/
  login.flow.json       reusable subflow
  read-invoices.flow.json
```

- Drag a **subflow** node, pick its ``path`` in Properties, and double-click
  the node to open it on the canvas.
- ``scope: shared`` (default) shares variables; ``scope: isolated`` passes
  only declared ``inputs`` in and copies declared ``outputs`` back.
- **Publish** ships the whole project as one pack (all flow files), so
  subflows travel with the main flow.

## Publishing a flow to smithcore-cloud

A flow becomes a **pack** (`smithcore-pack-v1`) and is pushed to a
[smithcore-cloud](https://github.com/as-kurosss/smithcore-cloud) orchestrator. The
cloud materializes a process named after the pack, and Windows agents run it
with the engine — packs ship *flows*, not Python code, so there is no runner
shim and nothing from the pack is imported:

```bash
# create an API token once (web UI → avatar → API tokens), then:
python -m smithcore_designer.publish flow.web.json \
    --url http://your-orchestrator:8000 \
    --token sct_... \
    --name my-flow \
    --version 1.0.0 \
    --open          # open the orchestrator on the new process
```

Versions are immutable: publishing the same `name`/`version` twice returns
409 — bump the version (omit `--version` to use the `1.0.<unixtime>` default).

The same publish is available in the designer UI: click **Publish**, enter the
orchestrator URL and an API token, and the flow is uploaded; **Open in
Orchestrator** then jumps to the process page. Run the designer and the
orchestrator as two browser tabs — edit and debug in the designer, deploy,
run and watch live logs in the orchestrator.

## Development

```bash
# backend
pip install -e ".[dev,tui]"
# frontend (vite dev server proxies /api to :8756)
cd designer-web && npm install && npm run dev
# in another terminal
smithcore-designer flow.json
```

## License

MIT — see [LICENSE](LICENSE).
