# Brickscope MCP Server

MCP server for identifying LEGO parts, sets, and minifigures from images using the [Brickognize API](https://api.brickognize.com/docs).

## Setup

### Option 1: npx (recommended)

No installation needed. Configure your MCP client to run:

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

### Option 2: From source

```bash
git clone https://github.com/NazarLysyi/brickognize-mcp.git
cd brickognize-mcp
npm install && npm run build
```

Then configure your MCP client:

```json
{
  "mcpServers": {
    "brickscope": {
      "command": "node",
      "args": ["/absolute/path/to/brickognize-mcp/dist/mcp/index.js"],
      "env": {
        "REBRICKABLE_API_KEY": "your-key-here",
        "BRICKOGNIZE_CACHE": "sqlite"
      }
    }
  }
}
```

## Environment Variables

| Variable              | Required | Default | Description                                                                                       |
| --------------------- | -------- | ------- | ------------------------------------------------------------------------------------------------- |
| `REBRICKABLE_API_KEY` | Optional | —       | Free API key from [rebrickable.com/api](https://rebrickable.com/api/). Required for lookup tools. |
| `BRICKOGNIZE_CACHE`   | Optional | `none`  | Cache backend for Rebrickable API responses. See [Caching](#caching) below.                       |

## Caching

Rebrickable API responses can be cached to speed up repeated lookups and reduce API calls. Configure with `BRICKOGNIZE_CACHE`:

| Value    | Behaviour                                                                     |
| -------- | ----------------------------------------------------------------------------- |
| `none`   | No caching (default). Every request hits the Rebrickable API.                 |
| `memory` | In-process cache. Fast, but cleared on every server restart.                  |
| `sqlite` | Persistent cache stored at `~/.cache/brickscope/cache.db`. Survives restarts. |

Use `sqlite` in production, `memory` for short-lived sessions, `none` to always get fresh data.

To clear the cache, call the `brickognize_cache_clear` tool (available when cache is enabled).

## Tools

### Recognition Tools

| Tool                         | Description                                          |
| ---------------------------- | ---------------------------------------------------- |
| `brickognize_health`         | Check API status                                     |
| `brickognize_identify`       | Identify any LEGO item from an image                 |
| `brickognize_identify_part`  | Identify a specific LEGO part                        |
| `brickognize_identify_set`   | Identify a LEGO set                                  |
| `brickognize_identify_fig`   | Identify a LEGO minifigure                           |
| `brickognize_batch_identify` | Identify multiple LEGO items from images in parallel |

### Lookup Tools (require `REBRICKABLE_API_KEY`)

| Tool                             | Description                                           |
| -------------------------------- | ----------------------------------------------------- |
| `brickognize_part_details`       | Part colors and which sets contain it (appears in)    |
| `brickognize_batch_part_details` | Same as above but for multiple parts in a single call |
| `brickognize_set_details`        | Set info, year, theme, and full parts inventory       |
| `brickognize_minifig_details`    | Minifigure info and which sets contain it             |

## Image Input

All single-image tools accept:

| Parameter    | Description                                                     |
| ------------ | --------------------------------------------------------------- |
| `imagePath`  | Absolute path to a local image file (JPEG, PNG, or WebP)        |
| `includeRaw` | Include raw Brickognize API response in output (default: false) |

### Batch Tool

`brickognize_batch_identify` processes multiple images in a single call — significantly faster than calling single-image tools in a loop.

| Parameter    | Description                                                                                |
| ------------ | ------------------------------------------------------------------------------------------ |
| `imagePaths` | Array of absolute paths to local image files (1–20 images)                                 |
| `type`       | `"part"` \| `"set"` \| `"fig"` \| `"general"` — type of identification (default: `"part"`) |
| `includeRaw` | Include raw Brickognize API response in each result (default: false)                       |

## Examples

See the [examples](../examples) folder for prompt templates you can use with this MCP server.
