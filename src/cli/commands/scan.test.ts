import { expect, it } from "vitest";
import { formatRegionsFile, toRegionsFile } from "./scan.js";

it("round-trips all settings that affect recognition crops", () => {
  const detectionSettings = { minContrast: 20, minPartSize: 0.1, joinGap: 0 };
  const text = formatRegionsFile(
    "photo.heic",
    { width: 400, height: 300 },
    0.12,
    [{ id: 1, box: [10, 20, 30, 40], cropBox: [8, 18, 32, 42] }],
    true,
    detectionSettings,
  );
  expect(toRegionsFile(JSON.parse(text), "regions.json")).toEqual({
    image: "photo.heic",
    size: { width: 400, height: 300 },
    padding: 0.12,
    boxes: [[10, 20, 30, 40]],
    isolateParts: true,
    detectionSettings,
  });
});

it("accepts old boxes files and rejects malformed isolation settings", () => {
  expect(toRegionsFile({ boxes: [] }, "old.json")).toEqual({ boxes: [] });
  expect(() => toRegionsFile({ boxes: [], isolateParts: "true" }, "bad.json")).toThrow("boolean");
  expect(() =>
    toRegionsFile({ boxes: [], detectionSettings: { joinGap: 100 } }, "bad.json"),
  ).toThrow("joinGap");
});

it("restores saved crop settings through --boxes-file and honors explicit overrides", async () => {
  const { Command } = await import("commander");
  const { mkdtemp, readFile, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { default: sharp } = await import("sharp");
  const { registerScanCommand } = await import("./scan.js");
  const { vi } = await import("vitest");
  const dir = await mkdtemp(join(tmpdir(), "brickscope-roundtrip-"));
  const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
  try {
    const image = join(dir, "photo.png");
    const file = join(dir, "regions.json");
    await sharp({ create: { width: 40, height: 30, channels: 3, background: "white" } })
      .png()
      .toFile(image);
    await writeFile(
      file,
      formatRegionsFile(image, { width: 40, height: 30 }, 0.12, [], true, {
        minContrast: 22,
        minPartSize: 0.1,
        joinGap: 0,
      }),
    );
    const run = async (extra: string[]) => {
      const program = new Command();
      registerScanCommand(program);
      await program.parseAsync(
        [
          "scan",
          image,
          "--boxes-file",
          file,
          "--detect-only",
          "--out-dir",
          dir,
          "--json",
          ...extra,
        ],
        { from: "user" },
      );
      return toRegionsFile(JSON.parse(await readFile(file, "utf8")), file);
    };
    const restored = await run([]);
    expect(restored.isolateParts).toBe(true);
    expect(restored.detectionSettings).toEqual({ minContrast: 22, minPartSize: 0.1, joinGap: 0 });
    expect(restored.padding).toBe(0.12);
    const overridden = await run(["--no-isolate", "--min-contrast", "15"]);
    expect(overridden.isolateParts).toBe(false);
    expect(overridden.detectionSettings?.minContrast).toBe(15);
  } finally {
    output.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
});
