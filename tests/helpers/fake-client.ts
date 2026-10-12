import type Anthropic from "@anthropic-ai/sdk";
import { vi } from "vitest";
import { MODELS } from "@/lib/config";

/** A stand-in client that returns queued responses and records each request. No network. */
export function fakeClient(responses: object[]) {
  const requests: Record<string, unknown>[] = [];
  const create = vi.fn(async (params: Record<string, unknown>, options?: unknown) => {
    void options;
    // Snapshot: the helper keeps appending to the same history array.
    requests.push(structuredClone(params));
    const next = responses.shift();
    if (!next) throw new Error("No more fake responses");
    return next;
  });
  const client = { beta: { messages: { create } } } as unknown as Anthropic;
  return { client, requests, create };
}

export const usage = { input_tokens: 400, output_tokens: 300 };
export const thinking = { type: "thinking", thinking: "", signature: "sig-1" };

/** A model turn that starts with a thinking block, as real responses do. */
export function jsonTurn(value: unknown, extra: object = {}) {
  return {
    model: MODELS.opus,
    content: [thinking, { type: "text", text: JSON.stringify(value) }],
    stop_reason: "end_turn",
    stop_details: null,
    usage,
    ...extra,
  };
}

export function refusalTurn(category = "cyber") {
  return {
    model: MODELS.opus,
    content: [],
    stop_reason: "refusal",
    stop_details: { category, explanation: "declined" },
    usage,
  };
}

/** The text of the last user message in a recorded request. */
export function lastUserText(request: Record<string, unknown>): string {
  const messages = request.messages as { role: string; content: unknown }[];
  const last = [...messages].reverse().find((message) => message.role === "user");
  return typeof last?.content === "string" ? last.content : JSON.stringify(last?.content);
}
