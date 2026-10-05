# Brickscope

Identify LEGO parts, sets, and minifigures from images — as a **CLI tool** or an **MCP server** for AI assistants.

Powered by the [Brickognize API](https://api.brickognize.com/docs) and [Rebrickable](https://rebrickable.com/api/).

Huge thanks to [Piotr Rybak](https://brickognize.com/about) for creating the Brickognize service and making LEGO recognition accessible to everyone!

## CLI

```bash
npm install -g brickscope

brickscope identify photo.jpg --type part
brickscope scan pile.jpg --detect-only   # several parts in one photo
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

HEIC decoding runs in a disposable worker with cancellation and a 30-second timeout; images over 100 megapixels are rejected before RGBA decoding. Decoder diagnostics go to stderr, keeping JSON output clean. Uploads are resized to at most 2048 pixels on the long side. File contents determine the decoder: JPEG/PNG/WebP magic overrides the extension, HEIF brands use libheif, and AVIF uses sharp (converted to JPEG for upload). Embedded HEIC ICC profiles, including Display-P3, are not applied by this decoder; colors may shift. Export an sRGB JPEG when accurate color matters.

Scan previews echo `padding`, `isolateParts` and `detectionSettings`; the CLI saves and restores them in `regions.json`. MCP callers must pass them back with approved boxes. Part lookups can return partial set lists; keep the fetched results and follow `remainingColors`.

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
- **Multi-part scan** — find, crop and identify several parts in one photo, with previews an AI assistant can review and correct
- **Part lookup** — colors, set appearances via Rebrickable
- **Set inventory** — full parts list, year, theme, piece count
- **Minifigure lookup** — details and set appearances
- **Caching** — in-memory or SQLite cache for Rebrickable API responses
- **Config file** — save API key and preferences once, use everywhere

## Photo tips for scanning several parts

Put the parts on a **plain, matte surface** (no wood grain or patterned fabric), with **even light** from above and a **small gap** between parts. Use the **original photo** from the phone — messengers shrink it so much that small parts like pins lose their detail. The surface color matters too: fuchsia or mint-green paper keeps ~99% of LEGO parts clearly visible, while white paper hides white, transparent and light gray parts. `brickscope scan` also returns tips for the photo you just took. [More](./docs/cli.md#taking-good-photos)

## Examples

See the [examples](./examples) folder for prompt templates.

## Development

```bash
pnpm install
pnpm build
pnpm dev              # Watch mode
pnpm test             # Unit + integration tests
pnpm lint             # ESLint
pnpm format           # Prettier
```

Requires Node.js 22.12+ and pnpm 12. The build uses TypeScript 7 (`@typescript/native`), while the `typescript` package is aliased to the TypeScript 6 API (`@typescript/typescript6`) because typescript-eslint and editors still need it.

### Releasing

Releases are automated with [release-please](https://github.com/googleapis/release-please). PR titles follow [Conventional Commits](https://www.conventionalcommits.org/) and are squash-merged: `fix:` bumps the patch version, `feat:` the minor version. After each merge to `main`, release-please keeps a release PR up to date with the version bump and `CHANGELOG.md`. Merging it tags the release, creates a GitHub Release and publishes to npm.

## License

MIT. HEIC photos are decoded with [libheif-js](https://github.com/catdad-experiments/libheif-js) (LGPL-3.0), used unmodified as a separate npm dependency. sharp also uses libvips (LGPL-3.0).
