import { describe, it, expect } from "vitest";
import { hexToLab } from "./color.js";
import type { DetectedRect, Segmentation } from "./segment.js";
import { photoTips, resolutionTip } from "./tips.js";

const WOOD = hexToLab("C9A27A");
const WHITE = hexToLab("F4F4F0");

function rect(
  left: number,
  top: number,
  width: number,
  height: number,
  hex: string,
  flags: Partial<Pick<DetectedRect, "large" | "touchesBorder">> = {},
): DetectedRect {
  return {
    left,
    top,
    width,
    height,
    color: hexToLab(hex),
    large: false,
    touchesBorder: false,
    ...flags,
  };
}

function segmentation(rects: DetectedRect[], overrides: Partial<Segmentation> = {}): Segmentation {
  return {
    rects,
    parts: [],
    labels: new Int32Array(1000 * 800).fill(-1),
    image: { data: new Uint8Array(1000 * 800 * 3), width: 1000, height: 800 },
    backgroundUniform: true,
    backgroundColor: WOOD,
    width: 1000,
    height: 800,
    ...overrides,
  };
}

const codes = (s: Segmentation) => photoTips(s).map((t) => t.code);

describe("resolutionTip", () => {
  it("asks for the original when a photo looks shrunk by a messenger", () => {
    expect(resolutionTip({ width: 960, height: 1280 })?.code).toBe("RESOLUTION");
  });

  it("is quiet for a full-size phone photo", () => {
    expect(resolutionTip({ width: 4032, height: 3024 })).toBeNull();
  });
});

describe("photoTips", () => {
  it("gives no tips for a clean photo", () => {
    expect(
      codes(segmentation([rect(100, 100, 80, 50, "05131D"), rect(400, 300, 60, 60, "C91A09")])),
    ).toEqual([]);
  });

  it("recommends a plain surface for a textured one, suited to the parts found", () => {
    const tips = photoTips(
      segmentation([rect(100, 100, 80, 50, "05131D")], { backgroundUniform: false }),
    );
    expect(tips.map((t) => t.code)).toEqual(["PLAIN_SURFACE"]);
    expect(tips[0].message).toContain("fuchsia");
  });

  it("does not blame contrast on a textured surface, where faint regions are texture", () => {
    const s = segmentation([rect(100, 100, 30, 30, "B89470")], { backgroundUniform: false });
    expect(codes(s)).not.toContain("CONTRAST");
  });

  it("spots a large dark region at the edge as a shadow", () => {
    const s = segmentation([
      rect(0, 400, 400, 400, "8C7A66", { large: true, touchesBorder: true }),
    ]);
    expect(codes(s)).toContain("SHADOW");
  });

  it("does not take a colorful table frame for a shadow", () => {
    const s = segmentation(
      [rect(0, 0, 1000, 800, "6B3A1A", { large: true, touchesBorder: true })],
      { backgroundColor: WHITE },
    );
    expect(codes(s)).not.toContain("SHADOW");
  });

  it("flags parts that blend into a plain surface and names a better one", () => {
    const tips = photoTips(
      segmentation([rect(100, 100, 80, 50, "FFFFFF"), rect(300, 100, 80, 50, "05131D")], {
        backgroundColor: WHITE,
      }),
    );
    expect(tips.map((t) => t.code)).toEqual(["CONTRAST"]);
    expect(tips[0].message).toContain("1 part(s)");
    expect(tips[0].message).toContain("light parts on a light surface");
  });

  it("asks to spread parts out when a big region in the middle holds several", () => {
    const s = segmentation([rect(200, 200, 400, 300, "05131D", { large: true })]);
    expect(codes(s)).toContain("SPREAD_PARTS");
  });

  it("does not ask to spread parts for one long diagonal part", () => {
    const s = segmentation([rect(200, 200, 300, 150, "05131D", { large: true })]);
    expect(codes(s)).not.toContain("SPREAD_PARTS");
  });
});
