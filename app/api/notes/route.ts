import fixtures from "@/fixtures/notes.json";
import type { NotesResult } from "@/lib/ai/notes";
import { NotesRequest, writeNotes } from "@/lib/ai/notes-live";
import { jsonRoute } from "@/lib/api";
import type { FixtureStore } from "@/lib/demo";

/**
 * The chosen set to one short transition note per mix (structured output, low
 * effort). The server recomputes the facts of each mix; the model only phrases advice.
 */
export const maxDuration = 60;

export const POST = jsonRoute({
  store: "notes",
  fixtures: fixtures as FixtureStore<NotesResult>,
  schema: NotesRequest,
  maxBytes: 48 * 1024,
  // The request's signal fires when the visitor cancels or leaves, which stops the model call.
  live: ({ body, client, req }) => writeNotes({ client, tracks: body.tracks, signal: req.signal }),
});
