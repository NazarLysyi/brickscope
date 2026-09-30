import { deltaE, hexToLab, type Lab3 } from "./color.js";
import type { Segmentation } from "./segment.js";

export type PhotoTipCode = "RESOLUTION" | "PLAIN_SURFACE" | "SHADOW" | "CONTRAST" | "SPREAD_PARTS";

/** Advice for the person taking the photo, so the next shot needs fewer corrections. */
export interface PhotoTip {
  code: PhotoTipCode;
  message: string;
}

/**
 * Household surfaces, best first by how many LEGO parts stand out on them: weighted by how
 * common each LEGO color is, fuchsia, mint green and lilac keep about 98–99% of parts at
 * ΔE ≥ 30, while white paper keeps about 68% (white, clear and light gray parts blend in)
 * and black cloth about 80% (black is the most common color).
 */
const SURFACES: { name: string; color: Lab3 }[] = [
  { name: "fuchsia or hot-pink paper", color: hexToLab("D0208C") },
  { name: "mint-green paper", color: hexToLab("9FE2BF") },
  { name: "lilac paper", color: hexToLab("C8A2E0") },
  { name: "sky-blue paper", color: hexToLab("8EC5F0") },
  { name: "yellow paper", color: hexToLab("FFE45C") },
  { name: "white paper", color: hexToLab("F4F4F0") },
  { name: "black cloth", color: hexToLab("1E1E1E") },
];

/** Parts closer than this to the surface color are easy to miss in real photos. */
const LOW_CONTRAST_DELTA_E = 25;
/** A shadow region is darker than the surface (soft shadows on texture only a little), */
const SHADOW_MIN_DARKER = 5;
/** ...no more colorful than it, and covers at least this share of the photo. */
const SHADOW_MIN_SHARE = 0.05;
/** Parts merged into one box cover at least this share of the photo. */
const MERGED_MIN_SHARE = 0.1;
/** A surface with at least this contrast to every part is good enough; prefer earlier ones. */
const COMFORTABLE_DELTA_E = 40;

/**
 * Phone cameras shoot 4000 px or more on the long side; messengers (Telegram, WhatsApp,
 * Viber) shrink photos to about 1280–1600 px, which leaves small parts like pins with too
 * few pixels to identify reliably.
 */
const MIN_PHOTO_LONG_SIDE = 2000;

/** Advice to send the original photo when this one looks shrunk by a messenger. */
export function resolutionTip(size: { width: number; height: number }): PhotoTip | null {
  if (Math.max(size.width, size.height) >= MIN_PHOTO_LONG_SIDE) return null;
  return {
    code: "RESOLUTION",
    message:
      `The photo is only ${size.width}×${size.height} pixels, likely shrunk by a messenger or an app. ` +
      "Small parts such as pins then have too little detail to identify reliably, and colors get less accurate. " +
      "Use the original photo from the phone: in Telegram send it as a file, in WhatsApp as a document, or copy it from the phone directly.",
  };
}

/** Photo-specific advice from auto-detection, most useful first. */
export function photoTips(segmentation: Segmentation): PhotoTip[] {
  const { rects, backgroundColor: surface, width, height } = segmentation;
  const tips: PhotoTip[] = [];
  const parts = rects.filter((r) => !r.large && !r.touchesBorder);
  // Regions that clearly differ from the surface are real parts; faint ones may be texture.
  const clear = parts.filter((r) => deltaE(r.color, surface) >= LOW_CONTRAST_DELTA_E);

  if (!segmentation.backgroundUniform) {
    const advice =
      clear.length > 0
        ? `For these parts, ${bestSurface(clear.map((r) => r.color))} works best`
        : `Fuchsia, mint-green or lilac paper suits most LEGO colors`;
    tips.push({
      code: "PLAIN_SURFACE",
      message:
        "The surface has a pattern or texture (wood grain, patterned fabric, carpet), which shows up as false boxes. " +
        `Put the parts on a plain, matte surface such as colored paper, a plain cloth or a yoga mat. ${advice}.`,
    });
  }

  const chroma = (c: Lab3) => Math.hypot(c[1], c[2]);
  const share = (r: { width: number; height: number }) => (r.width * r.height) / (width * height);
  const shadows = rects.filter(
    (r) =>
      r.large &&
      r.touchesBorder &&
      share(r) >= SHADOW_MIN_SHARE &&
      surface[0] - r.color[0] >= SHADOW_MIN_DARKER &&
      chroma(r.color) <= chroma(surface) + 5,
  );
  if (shadows.length > 0) {
    tips.push({
      code: "SHADOW",
      message:
        "A large dark area at the edge looks like a shadow, often from the phone or a hand, and dark parts inside it get lost. " +
        "Shoot from directly above with light from above or from several sides (a ceiling light or daylight), not one lamp from the side.",
    });
  }

  // On a textured surface faint regions are mostly the texture itself, not parts.
  const faint = parts.filter((r) => deltaE(r.color, surface) < LOW_CONTRAST_DELTA_E);
  if (segmentation.backgroundUniform && faint.length > 0) {
    const tone = faint.every((r) => r.color[0] < 40)
      ? "dark parts on a dark surface"
      : faint.every((r) => r.color[0] > 70)
        ? "light parts on a light surface"
        : "parts close in color to the surface";
    const better = bestSurface(parts.map((r) => r.color));
    tips.push({
      code: "CONTRAST",
      message:
        `${faint.length} part(s) barely stand out (${tone}) and are easy to miss. ` +
        `For these parts, ${better} would give much more contrast.`,
    });
  }

  const merged = rects.some((r) => r.large && !r.touchesBorder && share(r) >= MERGED_MIN_SHARE);
  if (merged) {
    tips.push({
      code: "SPREAD_PARTS",
      message:
        "Some parts seem to touch or overlap. Leave about a finger's width between parts so each one gets its own box.",
    });
  }

  return tips;
}

/**
 * The first household surface (in order of general suitability) with comfortable contrast
 * to every part color, else the one whose weakest contrast is highest.
 */
function bestSurface(colors: Lab3[]): string {
  const worst = (surface: (typeof SURFACES)[number]) =>
    Math.min(...colors.map((color) => deltaE(color, surface.color)));
  const comfortable = SURFACES.find((surface) => worst(surface) >= COMFORTABLE_DELTA_E);
  if (comfortable) return comfortable.name;
  return SURFACES.reduce((best, surface) => (worst(surface) > worst(best) ? surface : best)).name;
}
