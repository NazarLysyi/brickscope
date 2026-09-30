import type * as PartDetails from "../../core/rebrickable/partDetails.js";
import type * as Image from "../../core/image.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { rebrickableApiError } from "../../core/utils/errors.js";

vi.mock("../../core/rebrickable/partDetails.js", async (original) => ({
  ...(await original<typeof PartDetails>()),
  fetchPartDetails: vi.fn(),
}));
vi.mock("../../core/rebrickable/setDetails.js", () => ({
  fetchSetDetails: vi.fn(),
  buildSetSummary: () => "set",
  normalizeSetNum: (s: string) => s,
}));
vi.mock("../../core/rebrickable/minifigDetails.js", () => ({
  fetchMinifigDetails: vi.fn(),
  buildMinifigSummary: () => "fig",
}));
vi.mock("../../core/image.js", async (original) => ({
  ...(await original<typeof Image>()),
  resolveImage: vi.fn(),
}));
vi.mock("../../core/brickognize/client.js", () => ({ predict: vi.fn() }));
vi.mock("../../core/brickognize/mappers.js", () => ({
  mapPredictionResult: () => ({ summary: "identified" }),
}));
const { fetchPartDetails } = await import("../../core/rebrickable/partDetails.js");
const { fetchSetDetails } = await import("../../core/rebrickable/setDetails.js");
const { fetchMinifigDetails } = await import("../../core/rebrickable/minifigDetails.js");
const { predict } = await import("../../core/brickognize/client.js");
const { resolveImage } = await import("../../core/image.js");
const { registerPartDetailsTool, registerBatchPartDetailsTool } = await import("./partDetails.js");
const { registerSetDetailsTool } = await import("./setDetails.js");
const { registerMinifigDetailsTool } = await import("./minifigDetails.js");
const { registerPredictTools } = await import("./predict.js");
let client: Client;
beforeEach(async () => {
  vi.resetAllMocks();
  const server = new McpServer({ name: "test", version: "1" });
  registerPartDetailsTool(server);
  registerBatchPartDetailsTool(server);
  registerSetDetailsTool(server);
  registerMinifigDetailsTool(server);
  registerPredictTools(server);
  client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
});
afterEach(async () => {
  await client.close();
  vi.restoreAllMocks();
});

it("passes bounded cancellation signals to all single lookup tools", async () => {
  const timeout = vi.spyOn(AbortSignal, "timeout");
  vi.mocked(fetchPartDetails).mockRejectedValue(new Error("test"));
  vi.mocked(fetchSetDetails).mockRejectedValue(new Error("test"));
  vi.mocked(fetchMinifigDetails).mockRejectedValue(new Error("test"));
  for (const [name, args] of [
    ["brickognize_part_details", { partId: "1" }],
    ["brickognize_set_details", { setId: "1" }],
    ["brickognize_minifig_details", { minifigId: "1" }],
  ] as const)
    await client.callTool({ name, arguments: args });
  expect(vi.mocked(fetchPartDetails).mock.calls[0][2]).toBeInstanceOf(AbortSignal);
  expect(vi.mocked(fetchSetDetails).mock.calls[0][1]).toBeInstanceOf(AbortSignal);
  expect(vi.mocked(fetchMinifigDetails).mock.calls[0][1]).toBeInstanceOf(AbortSignal);
  expect(timeout.mock.calls.filter(([ms]) => ms === 50_000)).toHaveLength(3);
});

it.each([429, 500, 503, "timeout", "network", 404])(
  "classifies batch lookup failure %s",
  async (failure) => {
    const error =
      typeof failure === "number"
        ? rebrickableApiError(failure, "failure")
        : failure === "timeout"
          ? new DOMException("timeout", "TimeoutError")
          : new TypeError("fetch failed");
    vi.mocked(fetchPartDetails).mockRejectedValue(error);
    const result = await client.callTool({
      name: "brickognize_batch_part_details",
      arguments: { parts: [{ partId: "1" }] },
    });
    const content = result.content as { type: string; text: string }[];
    const text = content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    expect(text.includes("Not looked up:")).toBe(failure !== 404);
  },
);

it("starts the single prediction deadline before image loading and passes its signal", async () => {
  vi.mocked(resolveImage).mockResolvedValue({ blob: new Blob([]), filename: "image.jpg" });
  const before = Date.now();
  await client.callTool({
    name: "brickognize_identify_part",
    arguments: { imagePath: "/photo.jpg" },
  });
  const options = vi.mocked(predict).mock.calls[0][3]!;
  expect(options.deadline).toBeGreaterThanOrEqual(before + 50_000);
  expect(options.deadline).toBeLessThanOrEqual(Date.now() + 50_000);
  expect(options.signal).toBe(vi.mocked(resolveImage).mock.calls[0][1]);
});
