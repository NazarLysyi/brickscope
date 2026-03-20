# Brickognize MCP Server

MCP server for identifying LEGO parts, sets, and minifigures from images using the [Brickognize API](https://api.brickognize.com/docs).

Huge thanks to [Piotr Rybak](https://brickognize.com/about) for creating the Brickognize service and making LEGO recognition accessible to everyone!

## Setup

```bash
npm install
npm run build
```

## Configuration

Add to your MCP client config:

```json
{
  "mcpServers": {
    "brickognize": {
      "command": "node",
      "args": ["/absolute/path/to/brickognize-mcp/dist/index.js"]
    }
  }
}
```

## Tools

| Tool                         | Description                                          |
| ---------------------------- | ---------------------------------------------------- |
| `brickognize_health`         | Check API status                                     |
| `brickognize_identify`       | Identify any LEGO item from an image                 |
| `brickognize_identify_part`  | Identify a specific LEGO part                        |
| `brickognize_identify_set`   | Identify a LEGO set                                  |
| `brickognize_identify_fig`   | Identify a LEGO minifigure                           |
| `brickognize_batch_identify` | Identify multiple LEGO items from images in parallel |

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

See the [examples](./examples) folder for prompt templates you can use with this MCP server.

## Development

```bash
npm run dev           # Watch mode
npm run build         # Compile
npm run lint          # ESLint
npm run format        # Prettier
```
