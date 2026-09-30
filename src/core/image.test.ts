import { describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { imageFormat, resolveImage, resolveImagePath } from "./image.js";

const HEIC = fileURLToPath(new URL("./__fixtures__/parts.heic", import.meta.url));

describe("resolveImage", () => {
  it("sends HEIC photos as JPEG, since Brickognize rejects HEIC", async () => {
    const { blob, filename } = await resolveImage({ imagePath: HEIC });
    expect(blob.type).toBe("image/jpeg");
    expect(filename).toBe("image.jpg");
    const meta = await sharp(Buffer.from(await blob.arrayBuffer())).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 400, 300]);
  });

  it("reports a .heic file that isn't a HEIC image", async () => {
    const dir = await mkdtemp(join(tmpdir(), "brickscope-heic-"));
    const fake = join(dir, "fake.heic");
    await writeFile(fake, "not an image");
    try {
      await expect(resolveImage({ imagePath: fake })).rejects.toThrow(
        "Could not decode HEIC image",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("resolveImagePath", () => {
  it("accepts .heic and .heif, in any case", () => {
    expect(resolveImagePath("/photos/IMG_0001.HEIC").mime).toBe("image/heic");
    expect(resolveImagePath("/photos/pile.heif").mime).toBe("image/heif");
  });
});

it("routes recognized image content independently of the extension", async () => {
  const dir = await mkdtemp(join(tmpdir(), "brickscope-sniff-"));
  try {
    const png = await sharp({ create: { width: 20, height: 10, channels: 3, background: "red" } })
      .png()
      .toBuffer();
    const path = join(dir, "photo.heic");
    await writeFile(path, png);
    expect((await resolveImage({ imagePath: path })).blob.type).toBe("image/png");
    const heicPath = join(dir, "photo.jpg");
    await writeFile(heicPath, await readFile(HEIC));
    expect((await resolveImage({ imagePath: heicPath })).blob.type).toBe("image/jpeg");
    const { loadImage } = await import("./scan/load.js");
    expect((await loadImage(path)).size).toEqual({ width: 20, height: 10 });
    expect((await loadImage(heicPath)).size).toEqual({ width: 400, height: 300 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("prefers AVIF over generic HEIF compatible brands and recognizes other magic", () => {
  const ftyp = (major: string, compatible: string) => {
    const data = Buffer.alloc(20);
    data.writeUInt32BE(20);
    data.write("ftyp", 4);
    data.write(major, 8);
    data.write(compatible, 16);
    return data;
  };
  expect(imageFormat(ftyp("mif1", "avif"), ".heic")).toBe(".avif");
  for (const brand of ["heic", "heix", "mif1", "msf1", "hevc"]) {
    expect(imageFormat(ftyp(brand, ""), ".jpg")).toBe(".heic");
  }
  expect(imageFormat(Buffer.from([255, 216, 255]), ".heic")).toBe(".jpg");
  expect(imageFormat(Buffer.from("RIFF0000WEBP"), ".heic")).toBe(".webp");
});
