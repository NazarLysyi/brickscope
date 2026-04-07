# Brickscope

Identify LEGO parts, sets, and minifigures from images — as a **CLI tool** or an **MCP server** for AI assistants.

Powered by the [Brickognize API](https://api.brickognize.com/docs) and [Rebrickable](https://rebrickable.com/api/).

Huge thanks to [Piotr Rybak](https://brickognize.com/about) for creating the Brickognize service and making LEGO recognition accessible to everyone!

## CLI

```bash
npm install -g brickscope

brickscope identify photo.jpg --type part
brickscope part 3001 --color Black
brickscope set 75192
brickscope minifig fig-012805
```

Or run without installing: `npx brickscope identify photo.jpg`

[Full CLI documentation](./docs/cli.md)

## MCP Server

For AI assistants (Claude, Cursor, etc.), add to your MCP config:

```json
{
  "mcpServers": {
    "brickscope": {
      "command": "npx",
      "args": ["-y", "brickscope", "mcp"],
      "env": {
        "REBRICKABLE_API_KEY": "your-key-here",
        "BRICKOGNIZE_CACHE": "sqlite"
      }
    }
  }
}
```

[Full MCP documentation](./docs/mcp.md)

## Configuration

### Config file (CLI)

```bash
brickscope config init
```

Creates `~/.config/brickscope/config.json` with your Rebrickable API key and cache settings.

### Environment variables

| Variable              | Default | Description                                                                                       |
| --------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| `REBRICKABLE_API_KEY` | —       | Free API key from [rebrickable.com/api](https://rebrickable.com/api/). Required for lookup tools. |
| `BRICKOGNIZE_CACHE`   | `none`  | Cache mode: `none`, `memory`, or `sqlite`                                                         |

Environment variables take priority over the config file.

## Features

- **Image recognition** — identify parts, sets, minifigures, and stickers from photos
- **Batch processing** — identify multiple images in parallel
- **Part lookup** — colors, set appearances via Rebrickable
- **Set inventory** — full parts list, year, theme, piece count
- **Minifigure lookup** — details and set appearances
- **Caching** — in-memory or SQLite cache for Rebrickable API responses
- **Config file** — save API key and preferences once, use everywhere

## Examples

See the [examples](./examples) folder for prompt templates.

## Development

```bash
npm install
npm run build
npm run dev           # Watch mode
npm test              # Unit + integration tests
npm run lint          # ESLint
npm run format        # Prettier
```

## License

MIT
