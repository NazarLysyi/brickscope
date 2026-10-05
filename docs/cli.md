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

Identify LEGO item(s) from photo(s). Supports JPEG, PNG, WebP, HEIC and AVIF.

HEIC decoding runs in a disposable worker with cancellation and a 30-second timeout; images over 100 megapixels are rejected before RGBA decoding. Decoder diagnostics go to stderr, keeping JSON output clean. Uploads are resized to at most 2048 pixels on the long side. File contents determine the decoder: JPEG/PNG/WebP magic overrides the extension, HEIF brands use libheif, and AVIF uses sharp (converted to JPEG for upload). Embedded HEIC ICC profiles, including Display-P3, are not applied by this decoder; colors may shift. Export an sRGB JPEG when accurate color matters.

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

### `brickscope scan <image>`

Find and identify several LEGO parts in **one photo**, e.g. a handful of parts laid out on a table. Parts are found locally (no ML, no paid APIs), each one is cropped, and every crop is identified with Brickognize (parts endpoint with color prediction).

Auto-detection only proposes boxes. It works best on a plain background that contrasts with the parts and shows in most of the photo (parts slightly apart). A table visible around the sheet becomes a large region to drop. White or transparent parts, strong shadows, textured backgrounds and touching parts may need corrected boxes, so the intended flow is to review first:

```bash
# 1. Detect only: writes annotated.jpg (numbered boxes over a 10% grid),
#    crops.jpg (the crops exactly as they will be sent) and regions.json
brickscope scan pile.jpg --detect-only --out-dir ./scan

# 2. Review the images. Edit ./scan/regions.json if needed: remove boxes on background,
#    add missed parts, split boxes that hold several touching parts.

# 3. Identify exactly the approved boxes (padding, isolation and detection settings are restored too)
brickscope scan pile.jpg --boxes-file ./scan/regions.json --out-dir ./scan

# Or detect and identify in one go
brickscope scan pile.jpg
```

Boxes are `[x1, y1, x2, y2]` in **percent (0–100)** of the photo after EXIF rotation, so they don't depend on image resolution (a padded crop whose longer side is under 24 working-image pixels gets a `TINY_REGION` warning and a `Skipped: …` error; it is not sent for identification. The working image is at most 3000 pixels on its longer side). Read them off the grid in `annotated.jpg`, or pass them inline; `[]` approves no regions:

```bash
brickscope scan pile.jpg --boxes '[[10,12,24,30],[40,15,52,28]]'
```

The result lists the top match and color per region (`--json` has the top 3 of each), provisional counts per part and color (`3x 3001 Brick 2 x 4 [Red]`), and warnings such as `LARGE_REGION` (several touching parts, a table around the sheet, or a shadow), `REGION_TOUCHES_BORDER`, `BACKGROUND_NOT_UNIFORM`, `DUPLICATE_REGION`, `TINY_REGION`, `NO_REGIONS`, `TRUNCATED` or `RATE_LIMITED` (Brickognize is limiting requests; the remaining boxes were not sent). `--json` also includes `lookupBatches` (3 parts each, so lookups finish within client timeouts), ready to pass to the MCP `brickognize_batch_part_details` tool.

A `regions.json` records the photo's size and is rejected for a photo of a different size. It also saves `padding`, `isolateParts` and `detectionSettings`, including for manual boxes. `--boxes-file` restores them; explicit flags override saved values, and `--no-isolate` disables saved isolation. Files in `--out-dir` are overwritten on each run, but never the input photo.

**Options:**

- `--detect-only` — Only find parts and write previews; no Brickognize requests
- `--boxes <json>` — Approved boxes as JSON (up to 60), replaces auto-detection
- `--boxes-file <path>` — Read approved boxes, padding, isolation and detection settings from a file (e.g. `regions.json`)
- `-o, --out-dir <dir>` — Where to write `annotated.jpg`, `crops.jpg` and `regions.json` (default: a new temp dir)
- `--padding <ratio>` — Crop padding as a fraction of the part's longer side (default `0.08`, or the value in `--boxes-file`)
- `--max-regions <n>` — Maximum auto-detected regions to process, largest first, 1–60 (default `30`)
- `--min-contrast`, `--min-part-size`, `--join-gap` — Auto-detection tuning, see [Tuning auto-detection](#tuning-auto-detection)
- `--isolate` — Paint other detected parts out of each crop with the background color (off by default)
- `--json` — Output raw JSON

#### One part per crop

A box often holds a bit of a neighbor: a pin lying in the bend of a liftarm sits inside the liftarm's box. With `--isolate`, each crop has the other detected parts painted out with the surrounding background color, so Brickognize sees one part; `regions[].paintedOut` in `--json` lists whose parts were removed from a crop. A part belongs to the smallest box that holds its center and most of it. Touching parts merge into one detected region; when each of them has its own box (e.g. a gear lying against a beam, boxed separately), the region is split between the boxes so each crop shows its own part. Where the boxes overlap, color decides, and whatever one part encloses stays with it. Parts that fit no single box (shadows, touching parts sharing one box), duplicate boxes and a part boxed inside another box of the same color are left alone. `paintedOut` includes only regions whose pixels were actually painted. This also works for boxes passed with `--boxes`. It is off by default: Brickognize already finds the main part in a crop (on the test photos it located the intended part in the middle of every crop, with 0.93–0.99 confidence), and large painted patches shifted one color prediction from Black to Blue. Turn it on when the crop sheet shows a small part's crop dominated by a neighbor, or touching parts you boxed separately still showing in each other's crops.

#### Tuning auto-detection

Detection defaults suit a plain surface. When the preview shows a pattern of mistakes, detect again with adjusted settings (boxes you pass with `--boxes` always override detection):

| What the preview shows                                  | Try                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------ |
| Many small boxes on wood grain, fabric or dust          | `--min-contrast 18`–`25`, `--min-part-size 0.05`–`0.1`       |
| Parts close to the surface color are missed             | `--min-contrast 6`–`8`                                       |
| Nearby parts share one box                              | `--join-gap 0`–`0.2`, and a slightly higher `--min-contrast` |
| One part broken into several boxes (transparent, holes) | `--join-gap 1`–`2`                                           |
| Small parts (pins) disappear                            | lower `--min-part-size` (pins need about 0.05–0.1 at most)   |

- `--min-contrast` (ΔE, default 10): how different from the surface a pixel must be to count as part of a part.
- `--min-part-size` (% of the photo, default 0.03): smaller regions are dropped as specks.
- `--join-gap` (% of the photo's shorter side, default 0.5): gaps up to this wide are bridged, so a part stays one region.

On the two test photos in this project's history (black Technic parts on a wood floor and on patterned fabric), the defaults found 6 of 8 and 7 of 8 parts among 7 and 2 false boxes; `--min-contrast 20 --min-part-size 0.08` and `--min-contrast 22 --join-gap 0.2` found all 8 parts, each with a single shadow box left to drop. The settings used are in `detectionSettings` of the `--json` output.

#### Taking good photos

What matters most, in order:

1. **A plain, matte surface.** Wood grain, patterned fabric, carpet or cutting-mat grid lines are the biggest source of false boxes.
2. **Even light.** Shoot from directly above under a ceiling light or daylight. A single lamp from the side, or the phone's own shadow, hides dark parts.
3. **Small gaps.** About a finger's width between parts; touching parts become one box.
4. **The original photo.** Messengers shrink photos to about 1280–1600 px (Telegram, WhatsApp, Viber); a pin is then only ~40×60 px and gets misidentified, and colors drift. Send the original from the phone (as a file or document) or copy it directly — iPhone originals are HEIC, which brickscope reads; `scan` warns with a `RESOLUTION` tip when the long side is under 2000 px.
5. **A surface color LEGO rarely uses.** Weighted by how common each LEGO color is, the share of parts that stand out clearly (ΔE ≥ 30) on common household surfaces:

| Surface                  | Parts that stand out | Blends with                               |
| ------------------------ | -------------------- | ----------------------------------------- |
| Fuchsia / hot-pink paper | ~99%                 | magenta, coral, dark pink                 |
| Mint-green paper         | ~99%                 | sand green, yellowish green               |
| Chroma-key green cloth   | ~99%                 | bright green                              |
| Lilac paper              | ~98%                 | medium lavender, bright pink              |
| Light wood (plain)       | ~91%                 | nougat, tan — and grain counts as texture |
| Sky-blue paper           | ~84%                 | bright light blue, medium azure           |
| Black cloth              | ~80%                 | black, the most common LEGO color         |
| Gray surface             | ~64–74%              | light and dark bluish gray, silver        |
| White paper              | ~68%                 | white, transparent, light gray            |

White paper is one of the worst choices: white, transparent and light gray parts disappear into it. A plain fuchsia or mint-green sheet, cloth or yoga mat works for almost any pile.

Every auto-detected scan also returns `tips`: advice for the next photo based on this one (textured surface, a shadow, parts that blend in and a surface that would suit them, parts touching).

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

Without a matching `colorName`, lookups return at most the first 100 sets for each of the top 5 colors. Incomplete set lists or a budget expiring after part metadata return `partial: true` with the available `colorDetails` and `remainingColors`. Keep those results and look up each remaining color explicitly in a new call; exact-color lists are capped at 10 pages (1000 sets), so a still-partial list at that cap cannot be completed by repeating the same request. Transient failures (429, 5xx, request timeout or network failure) use the retryable `Not looked up: …` prefix in batches; 429 delays subsequent Rebrickable requests. Other errors should be corrected before retrying.
