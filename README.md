# smithy-designer

Visual flow editor for the [smithy](https://github.com/as-kurosss/smithy) RPA engine.

Drag nodes onto the canvas, connect them, configure tool selectors, and debug
the flow step by step — in the browser, against the local smithy engine.

![status](https://img.shields.io/badge/status-early%20beta-orange)
![license](https://img.shields.io/badge/license-MIT-green)

## Features

- **Visual canvas** — nodes for control flow (start/end/if/loop), variables
  (`set` node), and every registered smithy tool; free-form graph editing with
  minimap and zoom
- **Flowchart-standard shapes** — diamonds for decisions/loops, stadium
  terminators, card-shaped tool nodes, red `err` output for error handling
- **Step debugger** — run the flow against real Windows UI: pause on nodes or
  breakpoints (right-click a node), step, inspect and edit variables from a
  REPL terminal
- **SheRPA-style selectors** — selector fields rendered as one XML-like string
  (`<Element name="OK" control_type="Button"/>`), editable inline or through an
  attribute modal; copy/paste selectors between blocks
- **Typed variables** — `set` node with `auto / string / number / bool / json`
  value types
- **Labels** — double-click any block to annotate it; labels persist in the
  flow file

## Install

```bash
pip install smithy-designer
```

Requires Python 3.11+. For Windows UI-automation tools install the engine with
its `windows` extra: `pip install "smithy-py[windows]"`.

## Quick start

```bash
# build the UI once (Node 18+):
cd designer-web && npm install && npm run build && cd ..

# run the designer (opens the browser):
smithy-designer flow.json
# or:
python -m smithy_designer flow.json
```

The server binds to `127.0.0.1:8756` and serves the prebuilt bundle from
`designer-web/dist` (or `src/smithy_designer/static` in installed packages).

## Flow file

The flow document format is versioned — see the
[flow format contract](https://github.com/as-kurosss/smithy#flow-format-v2)
in the smithy repo. Current version: **v2**.

## Development

```bash
# backend
pip install -e ".[dev,tui]"
# frontend (vite dev server proxies /api to :8756)
cd designer-web && npm install && npm run dev
# in another terminal
smithy-designer flow.json
```

## License

MIT — see [LICENSE](LICENSE).
