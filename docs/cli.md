# Brickscope CLI

Command-line tool for identifying LEGO parts, sets, and minifigures from images.

## Installation

```bash
# Global install
npm install -g brickscope

# Or run without installing
npx brickscope --help
```

## Quick Start

```bash
# Check API status
brickscope health

# Identify a LEGO piece from a photo
brickscope identify photo.jpg --type part

# Look up a part by number
brickscope part 3001

# Look up a set
brickscope set 75192

# Look up a minifigure
brickscope minifig fig-012805
```

## Configuration

### Config file

Run the interactive setup:

```bash
brickscope config init
```

This creates `~/.config/brickscope/config.json` with your settings.

You can also set values directly:

```bash
brickscope config set rebrickableApiKey YOUR_KEY
brickscope config set cache sqlite
brickscope config show
brickscope config path
```

### Environment variables

Environment variables take priority over the config file:

```bash
export REBRICKABLE_API_KEY=your-key
export BRICKOGNIZE_CACHE=sqlite
```

### Priority order

1. Environment variables (highest)
2. Config file (`~/.config/brickscope/config.json`)

## Commands

### `brickscope health`

Check whether the Brickognize API is online.

```bash
brickscope health
brickscope health --json
```

### `brickscope identify <images...>`

Identify LEGO item(s) from photo(s). Supports JPEG, PNG, and WebP.

```bash
# Single image
brickscope identify photo.jpg

# Specify type for better accuracy
brickscope identify photo.jpg --type part
brickscope identify box.jpg --type set

# Multiple images (batch mode, processed in parallel)
brickscope identify photo1.jpg photo2.jpg photo3.jpg --type part
brickscope identify *.jpg --type part

# JSON output
brickscope identify photo.jpg --json
```

**Options:**

- `-t, --type <type>` — Item type: `general` (default), `part`, `set`, `fig`
- `--json` — Output raw JSON

### `brickscope part <ids...>`

Get details about LEGO part(s): available colors and which sets contain the part. Requires `REBRICKABLE_API_KEY`.

```bash
# Single part
brickscope part 3001

# Filter by color
brickscope part 3001 --color Black

# Multiple parts
brickscope part 3001 3002 3003

# JSON output
brickscope part 3001 --json
```

**Options:**

- `-c, --color <name>` — Filter by color name (e.g. `Black`, `Dark Bluish Gray`)
- `--json` — Output raw JSON

### `brickscope set <ids...>`

Get LEGO set details: inventory, year, theme, piece count. Requires `REBRICKABLE_API_KEY`.

The `-1` suffix is added automatically (e.g. `75192` becomes `75192-1`).

```bash
brickscope set 75192
brickscope set 75192 10268 --json
```

**Options:**

- `--json` — Output raw JSON

### `brickscope minifig <ids...>`

Get LEGO minifigure details and which sets contain it. Requires `REBRICKABLE_API_KEY`.

```bash
brickscope minifig fig-012805
brickscope minifig fig-012805 fig-000001 --json
```

**Options:**

- `--json` — Output raw JSON

### `brickscope mcp`

Start the MCP server in stdio mode. Used by AI assistants (Claude, Cursor, etc.) — you normally don't run this directly.

```bash
brickscope mcp
```

### `brickscope config`

Manage configuration.

```bash
brickscope config init    # Interactive setup wizard
brickscope config show    # Show current config (API key masked)
brickscope config path    # Print config file location
brickscope config set <key> <value>  # Set a value
```

**Config keys:**

- `rebrickableApiKey` — Your Rebrickable API key
- `cache` — Cache mode: `none`, `memory`, or `sqlite`
