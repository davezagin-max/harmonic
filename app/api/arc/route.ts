import fixtures from "@/fixtures/arc.json";
import type { ArcPlan } from "@/lib/ai/arc";
import { ArcRequest, generateArc } from "@/lib/ai/arc-live";
import { jsonRoute } from "@/lib/api";
import type { FixtureStore } from "@/lib/demo";

/** Description of a set in words to a target energy curve (structured output, low effort). */
export const maxDuration = 60;

export const POST = jsonRoute({
  store: "arc",
  fixtures: fixtures as FixtureStore<ArcPlan>,
  schema: ArcRequest,
  maxBytes: 4 * 1024,
  // The request's signal fires when the visitor cancels or leaves, which stops the model call.
  live: ({ body, client, req }) =>
    generateArc({ client, description: body.description, signal: req.signal }),
});
