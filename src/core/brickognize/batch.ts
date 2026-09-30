import { setTimeout as sleep } from "node:timers/promises";
import { runWithConcurrencyLimit } from "../concurrency.js";
import { BrickognizeError, formatToolError } from "../utils/errors.js";
import { predict } from "./client.js";
import type { RawSearchResults } from "./types.js";

/** Parallel Brickognize requests per call. */
export const PREDICT_CONCURRENCY = 5;

/** Outcomes the caller can simply retry later all start with "Not identified". */
export const NOT_IDENTIFIED = {
  budget: "Not identified: the time budget ran out; try it again.",
  cancelled: "Not identified: the call was cancelled.",
  rateLimited: "Not identified: Brickognize is limiting requests; try it again later.",
} as const;

export interface PredictInput {
  blob: Blob;
  filename: string;
}

export type PredictOutcome =
  { status: "ok"; raw: RawSearchResults } | { status: "error"; error: string };

export interface PredictManyOptions {
  /** Epoch ms after which no request starts and running ones are aborted. */
  deadline: number;
  /** Cancels everything, e.g. when an MCP client cancels the call. */
  signal?: AbortSignal;
}

/**
 * Identify many images with bounded concurrency, one shared deadline and cancellation.
 * A retryable 429 pauses new starts; only a final 429 stops the batch.
 * Requests already sent finish under predict()'s retry policy. Never throws: every input
 * gets an outcome. Inputs get the stop signal, so slow reads can be abandoned too.
 */
export async function predictMany(
  endpoint: string,
  inputs: ((signal: AbortSignal) => Promise<PredictInput>)[],
  options: PredictManyOptions,
): Promise<{ outcomes: PredictOutcome[]; rateLimited: boolean }> {
  const budget = AbortSignal.timeout(Math.max(1, options.deadline - Date.now()));
  const stop = options.signal ? AbortSignal.any([options.signal, budget]) : budget;
  let rateLimited = false;
  let pauseUntil = 0;
  const onRateLimited = (delayMs: number) => {
    pauseUntil = Math.max(pauseUntil, Date.now() + delayMs);
  };
  const waitForBackoff = async () => {
    while (!rateLimited && pauseUntil > Date.now()) {
      await sleep(pauseUntil - Date.now(), undefined, { signal: stop });
    }
  };

  const stopped = (): PredictOutcome | null => {
    if (options.signal?.aborted) return { status: "error", error: NOT_IDENTIFIED.cancelled };
    if (stop.aborted || Date.now() >= options.deadline) {
      return { status: "error", error: NOT_IDENTIFIED.budget };
    }
    if (rateLimited) return { status: "error", error: NOT_IDENTIFIED.rateLimited };
    return null;
  };

  const tasks = inputs.map((input) => async (): Promise<PredictOutcome> => {
    const before = stopped();
    if (before) return before;
    try {
      await waitForBackoff();
      const { blob, filename } = await input(stop);
      await waitForBackoff();
      // Things may have changed while the input was being read.
      const after = stopped();
      if (after) return after;
      const raw = await predict(endpoint, blob, filename, {
        signal: options.signal,
        deadline: options.deadline,
        onRateLimited,
      });
      return { status: "ok", raw };
    } catch (err) {
      if (err instanceof BrickognizeError) {
        if (err.status !== 429) return { status: "error", error: formatToolError(err) };
        rateLimited = true;
        return { status: "error", error: NOT_IDENTIFIED.rateLimited };
      }
      // Anything else after a cancel or past the deadline is the abort itself.
      if (options.signal?.aborted) return { status: "error", error: NOT_IDENTIFIED.cancelled };
      if (stop.aborted || Date.now() >= options.deadline)
        return { status: "error", error: NOT_IDENTIFIED.budget };
      return { status: "error", error: formatToolError(err) };
    }
  });

  const outcomes = await runWithConcurrencyLimit(tasks, PREDICT_CONCURRENCY);
  return { outcomes, rateLimited };
}
