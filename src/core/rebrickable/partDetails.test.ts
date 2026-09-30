import { beforeEach, expect, it, vi } from "vitest";
vi.mock("./client.js", () => ({
  getPartDetails: vi.fn(),
  getPartColors: vi.fn(),
  getPartColorSets: vi.fn(),
}));
const { getPartDetails, getPartColors, getPartColorSets } = await import("./client.js");
const { fetchPartDetails } = await import("./partDetails.js");

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getPartDetails).mockResolvedValue({
    part_num: "1",
    name: "Brick",
    part_img_url: null,
    part_url: "",
    part_cat_id: 1,
    external_ids: {},
    year_from: null,
    year_to: null,
    prints: [],
    molds: [],
    alternates: [],
    print_of: null,
  });
  vi.mocked(getPartColors).mockResolvedValue(
    ["Red", "Blue", "Black", "White", "Green"].map((color_name, color_id) => ({
      color_id,
      color_name,
      num_sets: 1000,
      num_set_parts: 1000,
      part_img_url: null,
      elements: [],
    })),
  );
  vi.mocked(getPartColorSets).mockResolvedValue([]);
});

it.each([undefined, "unknown"])(
  "bounds colorless/unmatched work to one page per color (%s)",
  async (color) => {
    const result = await fetchPartDetails("1", color);
    expect(getPartColorSets).toHaveBeenCalledTimes(5);
    expect(vi.mocked(getPartColorSets).mock.calls.every((args) => args[3] === 1)).toBe(true);
    expect(result.partial).toBe(true);
    expect(result.remainingColors).toEqual(["Red", "Blue", "Black", "White", "Green"]);
  },
);

it("preserves fetched colors on budget expiry and identifies what to fetch next", async () => {
  const controller = new AbortController();
  vi.mocked(getPartColorSets).mockImplementation(async (_part, id) => {
    if (id === 1) {
      controller.abort();
      controller.signal.throwIfAborted();
    }
    return [];
  });
  const result = await fetchPartDetails("1", undefined, controller.signal);
  expect(result.colorDetails.map((c) => c.colorName)).toEqual(["Red"]);
  expect(result.partial).toBe(true);
  expect(result.remainingColors).toContain("Blue");
  vi.mocked(getPartColorSets).mockResolvedValue([]);
  await fetchPartDetails("1", result.remainingColors![1]);
  expect(getPartColorSets).toHaveBeenLastCalledWith("1", 1, undefined, undefined);
});

it("keeps fetched colors when one set list times out or is rate limited", async () => {
  vi.mocked(getPartColorSets).mockImplementation(async (_part, id) => {
    if (id === 2)
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    return [];
  });
  const result = await fetchPartDetails("1");
  expect(result.colorDetails.map((c) => c.colorName)).toEqual(["Red", "Blue"]);
  expect(result.partial).toBe(true);
  expect(result.remainingColors).toEqual(expect.arrayContaining(["Black", "White", "Green"]));
});

it("still fails on a permanent error", async () => {
  vi.mocked(getPartColorSets).mockRejectedValue(new Error("boom"));
  await expect(fetchPartDetails("1")).rejects.toThrow("boom");
});
