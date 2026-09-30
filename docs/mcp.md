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
pnpm install && pnpm build
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
| `brickognize_scan_image`     | Find and identify several parts in one photo         |

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
| `imagePath`  | Absolute path to a local image file (JPEG, PNG, WebP, or HEIC)  |
| `includeRaw` | Include raw Brickognize API response in output (default: false) |

### Batch Tool

`brickognize_batch_identify` processes multiple images in a single call — significantly faster than calling single-image tools in a loop. It returns within about 50 seconds (typical MCP client timeouts are 60s): images not identified by then, or after a final Brickognize 429, come back as errors starting with `Not identified` and can be passed again in a new call. `brickognize_batch_part_details` works the same way (`Not looked up`); batches of 3 parts usually finish in time.

| Parameter    | Description                                                                                |
| ------------ | ------------------------------------------------------------------------------------------ |
| `imagePaths` | Array of absolute paths to local image files (1–20 images)                                 |
| `type`       | `"part"` \| `"set"` \| `"fig"` \| `"general"` — type of identification (default: `"part"`) |
| `includeRaw` | Include raw Brickognize API response in each result (default: false)                       |

### Scan Tool

`brickognize_scan_image` finds several parts in **one photo**, crops each one and identifies the crops (parts endpoint with color prediction). Detection runs locally and only proposes boxes; the assistant reviews and corrects them:

1. Call with `detectOnly: true`. The result includes two JPEG images: the photo with numbered boxes over a 10% grid, and a sheet of the crops exactly as they will be sent for recognition.
2. Fix the boxes if needed (drop background, add missed parts, split touching parts) and call again with the approved `boxes` (always pass them; `[]` approves none) plus `imageSize`, `padding`, `isolateParts` and the three `detectionSettings` values (`minContrast`, `minPartSize`, `joinGap`, passed as top-level parameters) from the detect-only result. Previews are only returned in detect-only mode.
3. Review `groups` (provisional counts per part and color) and pass each `lookupBatches` entry (3 parts each, so part lookups finish within client timeouts) to `brickognize_batch_part_details`, one call after another.

If the preview shows a pattern of mistakes (many boxes on wood grain, nearby parts in one box), the assistant can detect again with adjusted `minContrast`, `minPartSize` or `joinGap` — see [Tuning auto-detection](./cli.md#tuning-auto-detection). The settings used come back in `detectionSettings`.

Auto-detected results also include `tips` — advice for a better next photo (textured surface, shadow, parts that blend in, parts touching). The assistant should pass them on to the user; see [Taking good photos](./cli.md#taking-good-photos) for the full guidance.

Detection assumes the background shows in most of the photo; a table visible around the sheet becomes a large region to drop. A recovered 429 only pauses new starts for Retry-After/backoff. If a request finally fails with 429, the remaining boxes are not sent (`RATE_LIMITED` warning) and can be scanned again later.

Recognition stops after about 50 seconds so the call finishes within typical MCP client timeouts; regions not identified in time are reported as errors and can be scanned again on their own. Cancelling the call stops recognition too. Padded crops under 24 working-image pixels on their longer side (working image capped at 3000 pixels) are skipped with `TINY_REGION` and `Skipped: …`; retrying unchanged boxes will not help.

| Parameter      | Description                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `imagePath`    | Absolute path to a local photo (JPEG, PNG, WebP, or HEIC)                                                                  |
| `boxes`        | Approved boxes `[x1, y1, x2, y2]` in percent (0–100) of the image, up to 60; replaces auto-detection                       |
| `imageSize`    | `{ width, height }` from the detect-only result; a photo of another size is rejected                                       |
| `detectOnly`   | Only detect and return previews, no recognition requests (default: `false`)                                                |
| `padding`      | Crop padding as a fraction of each part's longer side (default: `0.08`)                                                    |
| `maxRegions`   | Maximum auto-detected regions, largest first, 1–60 (default: `30`); does not limit `boxes`                                 |
| `minContrast`  | Auto-detection: how different (ΔE) from the surface a part must be (default 10; raise on textured surfaces)                |
| `minPartSize`  | Auto-detection: smallest region kept, % of the photo (default 0.03; raise to drop specks)                                  |
| `joinGap`      | Auto-detection: gaps up to this % of the shorter side join into one region (default 0.5; lower to split close parts)       |
| `isolateParts` | Paint other detected parts out of each crop with the background color (default `false`); `regions[].paintedOut` lists them |
| `includeRaw`   | Include raw Brickognize API response per region (default: `false`)                                                         |

Best results come from a plain background that contrasts with the parts, with the parts slightly apart.

HEIC decoding runs in a disposable worker with cancellation and a 30-second timeout; images over 100 megapixels are rejected before RGBA decoding. Decoder diagnostics go to stderr, keeping JSON output clean. Uploads are resized to at most 2048 pixels on the long side. File contents determine the decoder: JPEG/PNG/WebP magic overrides the extension, HEIF brands use libheif, and AVIF uses sharp (converted to JPEG for upload). Embedded HEIC ICC profiles, including Display-P3, are not applied by this decoder; colors may shift. Export an sRGB JPEG when accurate color matters.

Without a matching `colorName`, lookups return at most the first 100 sets for each of the top 5 colors. Incomplete set lists or a budget expiring after part metadata return `partial: true` with the available `colorDetails` and `remainingColors`. Keep those results and look up each remaining color explicitly in a new call; exact-color lists are capped at 10 pages (1000 sets), so a still-partial list at that cap cannot be completed by repeating the same request. Transient failures (429, 5xx, request timeout or network failure) use the retryable `Not looked up: …` prefix in batches; 429 delays subsequent Rebrickable requests. Other errors should be corrected before retrying.

Single identify and lookup tools also share a 50-second budget with image loading, retries and queued requests. Cancellation removes queued Rebrickable callers immediately without consuming a request slot.

## Examples

See the [examples](../examples) folder for prompt templates you can use with this MCP server.
