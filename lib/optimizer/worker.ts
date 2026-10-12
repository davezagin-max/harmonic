/**
 * Web Worker entry: runs the optimizer off the main thread so a large crate
 * never freezes the page. One message in, one message out.
 */
import { optimize, type OptimizeInput, type OptimizeResult } from "./optimize";

export interface WorkerRequest {
  runId: number;
  input: OptimizeInput;
}

export interface WorkerResponse {
  runId: number;
  result: OptimizeResult;
  ms: number;
}

addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const started = performance.now();
  const result = optimize(event.data.input);
  const response: WorkerResponse = {
    runId: event.data.runId,
    result,
    ms: performance.now() - started,
  };
  postMessage(response);
});
