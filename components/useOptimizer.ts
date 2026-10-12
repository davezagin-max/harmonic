"use client";

import { useCallback, useEffect, useRef } from "react";
import { optimize, type OptimizeInput, type OptimizeResult } from "@/lib/optimizer/optimize";
import type { WorkerRequest, WorkerResponse } from "@/lib/optimizer/worker";

export interface RunOutput {
  result: OptimizeResult;
  ms: number;
}

function runInline(input: OptimizeInput): RunOutput {
  const started = performance.now();
  const result = optimize(input);
  return { result, ms: performance.now() - started };
}

/**
 * Runs the optimizer in a Web Worker. Starting a new run while one is in
 * flight stops the old worker, so only the latest request ever resolves with a
 * result; a superseded or cancelled run resolves with null. Falls back to the
 * main thread if the worker cannot start.
 */
export function useOptimizer() {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<{ runId: number; resolve: (output: RunOutput | null) => void } | null>(
    null,
  );
  const counterRef = useRef(0);

  const cancel = useCallback(() => {
    if (!pendingRef.current) return;
    workerRef.current?.terminate();
    workerRef.current = null;
    pendingRef.current.resolve(null);
    pendingRef.current = null;
  }, []);

  const run = useCallback(
    (input: OptimizeInput): Promise<RunOutput | null> => {
      cancel();
      const runId = ++counterRef.current;
      return new Promise((resolve) => {
        let worker = workerRef.current;
        if (!worker) {
          try {
            worker = new Worker(new URL("../lib/optimizer/worker.ts", import.meta.url), {
              type: "module",
            });
            workerRef.current = worker;
          } catch {
            resolve(runInline(input));
            return;
          }
        }
        pendingRef.current = { runId, resolve };
        worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
          if (pendingRef.current?.runId !== event.data.runId) return;
          pendingRef.current = null;
          resolve({ result: event.data.result, ms: event.data.ms });
        };
        worker.onerror = () => {
          if (pendingRef.current?.runId !== runId) return;
          workerRef.current?.terminate();
          workerRef.current = null;
          pendingRef.current = null;
          resolve(runInline(input));
        };
        const request: WorkerRequest = { runId, input };
        worker.postMessage(request);
      });
    },
    [cancel],
  );

  useEffect(
    () => () => {
      pendingRef.current?.resolve(null);
      pendingRef.current = null;
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  return { run, cancel };
}
