/**
 * Wording for where a piece of AI output came from. Driven entirely by the
 * response's own flags, so a hand-written sample can never be labelled as a
 * model run, and the labels correct themselves once real runs are recorded.
 */
interface Source {
  mode: "live" | "demo";
  placeholder: boolean;
}

export function sourceLabel(source: Source): string {
  if (source.mode === "live") return "Live from Claude Opus 5.5";
  return source.placeholder
    ? "Sample output, hand-written (not a model run)"
    : "Recorded Claude Opus 5.5 run";
}

/** One short sentence for a Claude feature, shown before anything has been requested. */
export function presetHint(isLive: boolean, placeholder: boolean): string {
  if (isLive) return "Live with your key.";
  return placeholder
    ? "No key: shows hand-written sample output, not a model run."
    : "No key: replays a recorded Claude Opus 5.5 run.";
}
