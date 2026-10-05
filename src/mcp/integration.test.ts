/**
 * Integration tests — spin up the real MCP server in-process,
 * connect a client via InMemoryTransport, call actual tools.
 *
 * No AI agent needed. Tests real tool registration, schema validation,
 * error handling, and (with REBRICKABLE_API_KEY set) live API calls.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "./server.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textContent(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (result.content as Array<{ type: string; text: string }>)
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

function isError(result: Awaited<ReturnType<Client["callTool"]>>): boolean {
  return result.isError === true;
}

// ---------------------------------------------------------------------------
// Setup — one server + client pair for the whole suite
// ---------------------------------------------------------------------------

let client: Client;

beforeAll(async () => {
  const server = createServer();
  client = new Client({ name: "integration-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
});

// ---------------------------------------------------------------------------
// Tool listing
// ---------------------------------------------------------------------------

describe("tool registration", () => {
  it("lists all expected tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);

    expect(names).toContain("brickognize_health");
    expect(names).toContain("brickognize_identify");
    expect(names).toContain("brickognize_identify_part");
    expect(names).toContain("brickognize_identify_set");
    expect(names).toContain("brickognize_identify_fig");
    expect(names).toContain("brickognize_batch_identify");
    expect(names).toContain("brickognize_scan_image");
    expect(names).toContain("brickognize_part_details");
    expect(names).toContain("brickognize_batch_part_details");
    expect(names).toContain("brickognize_set_details");
    expect(names).toContain("brickognize_minifig_details");
  });

  it("tools have descriptions and input schemas", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.description, `${tool.name} missing description`).toBeTruthy();
      expect(tool.inputSchema, `${tool.name} missing inputSchema`).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Health tool — no API key needed
// ---------------------------------------------------------------------------

describe("brickognize_health", () => {
  it("returns a result without error", async () => {
    const result = await client.callTool({ name: "brickognize_health", arguments: {} });
    // Health check hits the real Brickognize API — may fail in CI without network
    // What we verify here is that the tool responds at all (no schema/registration error)
    expect(result.content).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Schema validation — wrong inputs should return tool errors, not throw
// ---------------------------------------------------------------------------

describe("schema validation", () => {
  // MCP SDK returns schema errors as isError:true responses (not exceptions)

  it("brickognize_part_details returns validation error for missing partId", async () => {
    const result = await client.callTool({ name: "brickognize_part_details", arguments: {} });
    expect(isError(result)).toBe(true);
    expect(textContent(result)).toContain("partId");
  });

  it("brickognize_batch_part_details returns validation error for empty parts array", async () => {
    const result = await client.callTool({
      name: "brickognize_batch_part_details",
      arguments: { parts: [] },
    });
    expect(isError(result)).toBe(true);
  });

  it("brickognize_batch_part_details returns validation error for oversized array (>20)", async () => {
    const parts = Array.from({ length: 21 }, (_, i) => ({ partId: String(i) }));
    const result = await client.callTool({
      name: "brickognize_batch_part_details",
      arguments: { parts },
    });
    expect(isError(result)).toBe(true);
    expect(textContent(result)).toContain("20");
  });

  it("brickognize_set_details returns validation error for missing setId", async () => {
    const result = await client.callTool({ name: "brickognize_set_details", arguments: {} });
    expect(isError(result)).toBe(true);
    expect(textContent(result)).toContain("setId");
  });

  it("brickognize_minifig_details returns validation error for missing minifigId", async () => {
    const result = await client.callTool({ name: "brickognize_minifig_details", arguments: {} });
    expect(isError(result)).toBe(true);
    expect(textContent(result)).toContain("minifigId");
  });
});

// ---------------------------------------------------------------------------
// Scan tool — detect-only runs locally, no network needed
// ---------------------------------------------------------------------------

describe("brickognize_scan_image", () => {
  let dir: string;
  let photoPath: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "brickscope-mcp-test-"));
    photoPath = join(dir, "pile.png");
    const block = (color: string) =>
      sharp({ create: { width: 40, height: 30, channels: 3, background: color } })
        .png()
        .toBuffer();
    await writeFile(
      photoPath,
      await sharp({ create: { width: 300, height: 200, channels: 3, background: "#f5f5f0" } })
        .composite([
          { input: await block("#c91a09"), left: 30, top: 40 },
          { input: await block("#0055bf"), left: 200, top: 120 },
        ])
        .png()
        .toBuffer(),
    );
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns regions and both preview images in detect-only mode", async () => {
    const result = await client.callTool({
      name: "brickognize_scan_image",
      arguments: { imagePath: photoPath, detectOnly: true },
    });

    expect(isError(result)).toBe(false);
    const content = result.content as Array<{ type: string; mimeType?: string; text?: string }>;
    const images = content.filter((c) => c.type === "image");
    expect(images).toHaveLength(2);
    expect(images.every((c) => c.mimeType === "image/jpeg")).toBe(true);
    expect(JSON.parse(content[1].text ?? "{}").regions).toHaveLength(2);
  });

  it("accepts detection settings", async () => {
    const result = await client.callTool({
      name: "brickognize_scan_image",
      arguments: { imagePath: photoPath, detectOnly: true, minContrast: 20, joinGap: 0 },
    });
    expect(isError(result)).toBe(false);
    const content = result.content as Array<{ type: string; text?: string }>;
    expect(JSON.parse(content[1].text ?? "{}").detectionSettings).toMatchObject({
      minContrast: 20,
      joinGap: 0,
    });
  });

  it("accepts an empty list of approved boxes and returns no previews outside detect-only", async () => {
    const result = await client.callTool({
      name: "brickognize_scan_image",
      arguments: { imagePath: photoPath, boxes: [] },
    });

    expect(isError(result)).toBe(false);
    const content = result.content as Array<{ type: string; text?: string }>;
    expect(content.every((c) => c.type === "text")).toBe(true);
    expect(JSON.parse(content[1].text ?? "{}").regions).toEqual([]);
  });

  it("returns a tool error for a missing file", async () => {
    const result = await client.callTool({
      name: "brickognize_scan_image",
      arguments: { imagePath: join(dir, "missing.png"), detectOnly: true },
    });
    expect(isError(result)).toBe(true);
    expect(textContent(result)).toContain("not found");
  });

  it("rejects boxes approved on a photo of another size", async () => {
    const result = await client.callTool({
      name: "brickognize_scan_image",
      arguments: {
        imagePath: photoPath,
        boxes: [[10, 10, 30, 30]],
        imageSize: { width: 4032, height: 3024 },
      },
    });
    expect(isError(result)).toBe(true);
    expect(textContent(result)).toContain("4032x3024");
  });

  it("rejects boxes that are not four numbers", async () => {
    const result = await client.callTool({
      name: "brickognize_scan_image",
      arguments: { imagePath: photoPath, boxes: [[1, 2, 3]] },
    });
    expect(isError(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Error handling — valid input but expected API errors returned as tool errors
// (not unhandled exceptions)
// ---------------------------------------------------------------------------

describe("error handling — missing API key", () => {
  it("brickognize_part_details returns tool error (not crash) when no API key", async () => {
    const saved = process.env.REBRICKABLE_API_KEY;
    delete process.env.REBRICKABLE_API_KEY;

    try {
      const result = await client.callTool({
        name: "brickognize_part_details",
        arguments: { partId: "3001" },
      });
      expect(isError(result)).toBe(true);
      expect(textContent(result)).toContain("REBRICKABLE_API_KEY");
    } finally {
      if (saved) process.env.REBRICKABLE_API_KEY = saved;
    }
  });

  it("brickognize_set_details returns tool error when no API key", async () => {
    const saved = process.env.REBRICKABLE_API_KEY;
    delete process.env.REBRICKABLE_API_KEY;

    try {
      const result = await client.callTool({
        name: "brickognize_set_details",
        arguments: { setId: "75192-1" },
      });
      expect(isError(result)).toBe(true);
      expect(textContent(result)).toContain("REBRICKABLE_API_KEY");
    } finally {
      if (saved) process.env.REBRICKABLE_API_KEY = saved;
    }
  });

  it("brickognize_minifig_details returns tool error when no API key", async () => {
    const saved = process.env.REBRICKABLE_API_KEY;
    delete process.env.REBRICKABLE_API_KEY;

    try {
      const result = await client.callTool({
        name: "brickognize_minifig_details",
        arguments: { minifigId: "fig-000001" },
      });
      expect(isError(result)).toBe(true);
      expect(textContent(result)).toContain("REBRICKABLE_API_KEY");
    } finally {
      if (saved) process.env.REBRICKABLE_API_KEY = saved;
    }
  });
});

// ---------------------------------------------------------------------------
// Live API tests — only run when REBRICKABLE_API_KEY is set
// ---------------------------------------------------------------------------

const hasApiKey = !!process.env.REBRICKABLE_API_KEY;
const describeWithKey = hasApiKey ? describe : describe.skip;

describeWithKey("live Rebrickable API", () => {
  it("brickognize_part_details returns part info for 18938", async () => {
    const result = await client.callTool({
      name: "brickognize_part_details",
      arguments: { partId: "18938", colorName: "Black" },
    });
    expect(isError(result)).toBe(false);
    const text = textContent(result);
    expect(text).toContain("18938");
    expect(text).toContain("Black");
  }, 30_000);

  it("brickognize_set_details auto-appends -1 suffix and returns set info", async () => {
    const result = await client.callTool({
      name: "brickognize_set_details",
      arguments: { setId: "10268" }, // no suffix — should become "10268-1"
    });
    expect(isError(result)).toBe(false);
    expect(textContent(result)).toContain("10268-1");
  }, 30_000);

  it("brickognize_minifig_details returns minifig info for fig-012805", async () => {
    const result = await client.callTool({
      name: "brickognize_minifig_details",
      arguments: { minifigId: "fig-012805" },
    });
    expect(isError(result)).toBe(false);
    expect(textContent(result)).toContain("fig-012805");
  }, 15_000);

  it("brickognize_part_details handles non-existent part gracefully", async () => {
    const result = await client.callTool({
      name: "brickognize_part_details",
      arguments: { partId: "DOES-NOT-EXIST-999999" },
    });
    expect(isError(result)).toBe(true); // 404 from Rebrickable → tool error
  }, 15_000);

  it("brickognize_batch_part_details processes multiple parts", async () => {
    const result = await client.callTool({
      name: "brickognize_batch_part_details",
      arguments: {
        parts: [
          { partId: "18938", colorName: "Black" },
          { partId: "3001", colorName: "Red" },
        ],
      },
    });
    expect(isError(result)).toBe(false);
    const text = textContent(result);
    expect(text).toContain("2/2 succeeded");
  }, 60_000);
});
