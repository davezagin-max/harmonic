"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArcEditor } from "@/components/ArcEditor";
import { ArcPrompt, type AppliedArc } from "@/components/ArcPrompt";
import { CamelotWheel } from "@/components/CamelotWheel";
import { CostMeter } from "@/components/kit/CostMeter";
import { useKey } from "@/components/kit/KeyProvider";
import { SetList } from "@/components/SetList";
import { StatsCard } from "@/components/StatsCard";
import { Toolbar } from "@/components/Toolbar";
import { useOptimizer } from "@/components/useOptimizer";
import { validateArc, type ArcPlan } from "@/lib/ai/arc";
import {
  buildMixes,
  MAX_SET_TRACKS,
  notesFit,
  type MixNote,
  type NotesResult,
} from "@/lib/ai/notes";
import type { ApiMeta, ErrorKind } from "@/lib/api";
import { callApi } from "@/lib/client";
import { decodeText } from "@/lib/crate/csv";
import { setListCsv, setListM3u } from "@/lib/crate/export";
import { importCrate, MAX_IMPORT_BYTES, type ImportReport } from "@/lib/crate/import";
import { SAMPLE_CRATE_CSV, SAMPLE_CRATE_NAME, SAMPLE_TRACKS } from "@/lib/crate/sample";
import { formatLength, planSet } from "@/lib/crate/set";
import type { Track } from "@/lib/crate/types";
import {
  DEFAULT_SET_DEMO_ID,
  DEFAULT_TARGET_MIN,
  MAX_TARGET_MIN,
  MIN_TARGET_MIN,
  noteTracks,
} from "@/lib/defaults";
import { DEFAULT_ARC, type ArcPoint } from "@/lib/music/energy";
import {
  DEFAULT_SEED,
  DEFAULT_WEIGHTS,
  type OptimizeInput,
  type OptimizeResult,
  type Weights,
} from "@/lib/optimizer/optimize";
import { presetHint, sourceLabel } from "@/lib/ui/labels";

interface Crate {
  /** Distinguishes crates whose track ids repeat ("t001" exists in every crate). */
  uid: number;
  name: string;
  tracks: readonly Track[];
  report: ImportReport | null;
  isSample: boolean;
}

/** What the visitor has asked for. */
interface Plan {
  crate: Crate;
  arc: ArcPoint[];
  targetMin: number;
  weights: Weights;
  seed: number;
}

/** The last finished optimizer run, with the exact input it was computed from. */
interface Computed {
  crateUid: number;
  input: OptimizeInput;
  result: OptimizeResult;
  ms: number | null;
}

interface ApiFailure {
  kind: ErrorKind;
  message: string;
}

interface StoredNotes {
  signature: string;
  notes: MixNote[];
  meta: ApiMeta;
}

export interface StudioProps {
  /** The default set, optimized on the server so the first paint is not empty. */
  initial: OptimizeResult;
  /** Whether the demo fixtures are still hand-written samples, per store. */
  demo: { arcPlaceholder: boolean; notesPlaceholder: boolean };
}

const SAMPLE_CRATE: Crate = {
  uid: 0,
  name: SAMPLE_CRATE_NAME,
  tracks: SAMPLE_TRACKS,
  report: null,
  isSample: true,
};

const DEFAULT_PLAN: Plan = {
  crate: SAMPLE_CRATE,
  arc: DEFAULT_ARC,
  targetMin: DEFAULT_TARGET_MIN,
  weights: DEFAULT_WEIGHTS,
  seed: DEFAULT_SEED,
};

function toInput(plan: Plan): OptimizeInput {
  return {
    tracks: plan.crate.tracks,
    arc: plan.arc,
    targetSec: plan.targetMin * 60,
    weights: plan.weights,
    seed: plan.seed,
  };
}

function isDefaultPlan(plan: Plan): boolean {
  return (
    plan.crate.isSample &&
    plan.targetMin === DEFAULT_TARGET_MIN &&
    plan.seed === DEFAULT_SEED &&
    JSON.stringify(plan.weights) === JSON.stringify(DEFAULT_WEIGHTS) &&
    JSON.stringify(plan.arc) === JSON.stringify(DEFAULT_ARC)
  );
}

function download(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const card = "rounded-lg border border-border bg-surface";
const small = "rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-raised";

export function Studio({ initial, demo }: StudioProps) {
  const { apiKey, isLive, openKeyModal } = useKey();
  const { run, cancel } = useOptimizer();

  const defaultComputed = useMemo<Computed>(
    () => ({ crateUid: 0, input: toInput(DEFAULT_PLAN), result: initial, ms: null }),
    [initial],
  );
  const [plan, setPlan] = useState<Plan>(DEFAULT_PLAN);
  const [computed, setComputed] = useState<Computed>(defaultComputed);
  const [busy, setBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const crateCounter = useRef(0);

  const [arcBusy, setArcBusy] = useState(false);
  const [arcError, setArcError] = useState<ApiFailure | null>(null);
  const [appliedArc, setAppliedArc] = useState<AppliedArc | null>(null);
  const arcAbort = useRef<AbortController | null>(null);

  const [notesBusy, setNotesBusy] = useState(false);
  const [notesError, setNotesError] = useState<ApiFailure | null>(null);
  const [storedNotes, setStoredNotes] = useState<StoredNotes | null>(null);
  const notesAbort = useRef<AbortController | null>(null);

  // Leaving the page stops any request still in flight, so no model call outlives the visit.
  useEffect(
    () => () => {
      arcAbort.current?.abort();
      notesAbort.current?.abort();
    },
    [],
  );

  const { tracks } = computed.input;
  const set = useMemo(
    () => planSet(tracks, computed.result.order, computed.input.arc, computed.input.targetSec),
    [tracks, computed],
  );
  const signature = `${computed.crateUid}:${set.entries.map((entry) => entry.track.id).join(",")}`;
  const isDefaultSet =
    computed.crateUid === 0 &&
    computed.result.order.length === initial.order.length &&
    computed.result.order.every((index, position) => index === initial.order[position]);

  const notes = useMemo(() => {
    const map = new Map<number, MixNote>();
    if (storedNotes && storedNotes.signature === signature) {
      for (const note of storedNotes.notes) map.set(note.index, note);
    }
    return map;
  }, [storedNotes, signature]);
  const notesShown = notes.size > 0 && storedNotes !== null;

  /** Every change to the plan goes through here: it updates the plan and re-runs the search. */
  function applyPlan(next: Plan) {
    setPlan(next);
    // The set is about to change, so notes being written for the old one are abandoned.
    stopNotes();
    setSelectedId(null);
    setHoverId(null);
    if (isDefaultPlan(next)) {
      // The default set was computed on the server; restoring it needs no search.
      cancel();
      setComputed(defaultComputed);
      setBusy(false);
      return;
    }
    const input = toInput(next);
    setBusy(true);
    void run(input).then((output) => {
      if (!output) return;
      setComputed({ crateUid: next.crate.uid, input, result: output.result, ms: output.ms });
      setBusy(false);
    });
  }

  async function handleImport(file: File) {
    setImportError(null);
    if (file.size > MAX_IMPORT_BYTES) {
      setImportError(
        "That file is over 2 MB. Export a single playlist or crate rather than a whole library.",
      );
      return;
    }
    let text: string;
    try {
      text = decodeText(new Uint8Array(await file.arrayBuffer()));
    } catch {
      setImportError("That file could not be read as text.");
      return;
    }
    const result = importCrate(text);
    if (!result.ok) {
      setImportError(result.error);
      return;
    }
    crateCounter.current += 1;
    applyPlan({
      ...plan,
      crate: {
        uid: crateCounter.current,
        name: file.name.replace(/\.[A-Za-z0-9]+$/, "").slice(0, 60) || "Imported crate",
        tracks: result.tracks,
        report: result.report,
        isSample: false,
      },
    });
  }

  function stopArc() {
    arcAbort.current?.abort();
    arcAbort.current = null;
    setArcBusy(false);
  }

  function stopNotes() {
    notesAbort.current?.abort();
    notesAbort.current = null;
    setNotesBusy(false);
  }

  async function runArc(body: { demoId?: string; description: string }) {
    stopArc();
    const controller = new AbortController();
    arcAbort.current = controller;
    setArcBusy(true);
    setArcError(null);
    const response = await callApi<ArcPlan>("/api/arc", body, apiKey, controller.signal);
    if (controller.signal.aborted) return;
    arcAbort.current = null;
    setArcBusy(false);
    if (!response.ok) {
      setArcError(response.error);
      return;
    }
    // Checked again in the browser: the curve is only applied if it is a valid arc.
    const arc = validateArc(response.data);
    if (!arc) {
      setArcError({ kind: "server", message: "The curve that came back was not usable." });
      return;
    }
    const targetMin =
      arc.durationMinutes === null
        ? plan.targetMin
        : Math.min(MAX_TARGET_MIN, Math.max(MIN_TARGET_MIN, arc.durationMinutes));
    setAppliedArc({
      description: body.description,
      summary: arc.summary,
      durationMinutes: arc.durationMinutes === null ? null : targetMin,
      meta: response.meta,
    });
    applyPlan({ ...plan, arc: arc.points, targetMin });
  }

  async function runNotes() {
    stopNotes();
    const requestTracks = noteTracks(tracks, computed.result.order);
    const requestSignature = signature;
    const controller = new AbortController();
    notesAbort.current = controller;
    setNotesBusy(true);
    setNotesError(null);
    const body = isDefaultSet
      ? { demoId: DEFAULT_SET_DEMO_ID, tracks: requestTracks }
      : { tracks: requestTracks };
    const response = await callApi<NotesResult>("/api/notes", body, apiKey, controller.signal);
    if (controller.signal.aborted) return;
    notesAbort.current = null;
    setNotesBusy(false);
    if (!response.ok) {
      setNotesError(response.error);
      return;
    }
    // Checked again in the browser against this exact set, with the same fact check the server runs.
    if (!notesFit(buildMixes(requestTracks), response.data)) {
      setNotesError({
        kind: "server",
        message: "The notes that came back did not match this set.",
      });
      return;
    }
    setStoredNotes({
      signature: requestSignature,
      notes: response.data.notes,
      meta: response.meta,
    });
  }

  function resetAll() {
    setImportError(null);
    setAppliedArc(null);
    setArcError(null);
    stopArc();
    applyPlan(DEFAULT_PLAN);
  }

  const activeId = hoverId ?? selectedId;
  const select = (id: string) => setSelectedId((current) => (current === id ? null : id));
  const targetSec = computed.input.targetSec;
  const tooLongForNotes = set.entries.length > MAX_SET_TRACKS;
  const canWriteNotes = set.stats.mixes > 0 && !tooLongForNotes && (isLive || isDefaultSet);
  const ruleNotes = storedNotes
    ? storedNotes.notes.filter((note) => note.source === "rule").length
    : 0;
  const fileStem = `harmonic-set-${Math.round(targetSec / 60)}min`;

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-3 py-4 sm:px-5">
      <Toolbar
        crateName={plan.crate.name}
        trackCount={plan.crate.tracks.length}
        isSample={plan.crate.isSample}
        report={plan.crate.report}
        importError={importError}
        onImport={handleImport}
        onUseSample={() => {
          setImportError(null);
          applyPlan({ ...plan, crate: SAMPLE_CRATE });
        }}
        onDownloadSample={() => download("harmonic-sample-crate.csv", SAMPLE_CRATE_CSV, "text/csv")}
        targetMin={plan.targetMin}
        onTargetMin={(targetMin) => applyPlan({ ...plan, targetMin })}
        weights={plan.weights}
        onWeights={(weights) => applyPlan({ ...plan, weights })}
        seed={plan.seed}
        busy={busy}
        onOptimize={() => applyPlan({ ...plan, seed: plan.seed + 1 })}
        canReset={!isDefaultPlan(plan)}
        onReset={resetAll}
      />

      <div className="studio-grid">
        <section
          aria-labelledby="wheel-title"
          className={`${card} min-w-0 p-2 [grid-area:wheel] sm:p-3`}
        >
          <h2 id="wheel-title" className="sr-only">
            Camelot wheel
          </h2>
          <div className="mx-auto w-full max-w-[620px]">
            <CamelotWheel
              tracks={tracks}
              set={set}
              activeId={activeId}
              onHover={setHoverId}
              onSelect={select}
              setSignature={signature}
              headline={{
                top: `${set.entries.length} of ${tracks.length} tracks · ${formatLength(set.totalSec)}`,
                middle: `${computed.result.improvementPct.toFixed(0)}%`,
                bottom: "lower cost than a random order",
              }}
            />
          </div>
          <p className="px-2 pb-1 pt-1 text-center text-xs text-muted">
            Dots are tracks in their key; the numbered path is the set. Point at a track to see its
            clean mixes.
          </p>
        </section>

        <section aria-labelledby="arc-title" className={`${card} min-w-0 p-4 [grid-area:arc]`}>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
            <h2 id="arc-title" className="text-sm font-semibold">
              Energy arc
            </h2>
            <p className="text-xs text-muted">Edit it and the set re-plans.</p>
          </div>
          <ArcEditor
            arc={plan.arc}
            onChange={(arc) => setPlan({ ...plan, arc })}
            onCommit={(arc) => {
              // A hand edit replaces whatever description the curve came from.
              setAppliedArc(null);
              applyPlan({ ...plan, arc });
            }}
            set={set}
            targetSec={targetSec}
            activeId={activeId}
            onHover={setHoverId}
          />
          <ArcPrompt
            isLive={isLive}
            placeholder={demo.arcPlaceholder}
            busy={arcBusy}
            error={arcError}
            applied={appliedArc}
            onRun={runArc}
            onCancel={stopArc}
            onAddKey={openKeyModal}
          />
        </section>

        <section aria-labelledby="set-title" className={`${card} min-w-0 p-4 [grid-area:set]`}>
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div>
              <h2 id="set-title" className="text-sm font-semibold">
                Set list
              </h2>
              <p className="text-xs text-muted" aria-live="polite">
                {busy
                  ? "Optimizing…"
                  : `${set.entries.length} tracks · ${formatLength(set.totalSec)} of ${formatLength(targetSec)}`}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                className={small}
                disabled={set.entries.length === 0}
                onClick={() =>
                  download(
                    `${fileStem}.csv`,
                    setListCsv(set, new Map([...notes].map(([index, note]) => [index, note.note]))),
                    "text/csv",
                  )
                }
              >
                Export CSV
              </button>
              <button
                type="button"
                className={small}
                disabled={set.entries.length === 0}
                onClick={() =>
                  download(
                    `${fileStem}.m3u`,
                    setListM3u(set, `Harmonic set, ${formatLength(targetSec)}`),
                    "audio/x-mpegurl",
                  )
                }
              >
                Export M3U
              </button>
            </div>
          </div>

          <div className="mt-3 rounded-md border border-border bg-raised/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <h3 className="text-sm font-medium">Transition notes</h3>
              <div className="flex items-center gap-2">
                {notesBusy ? (
                  <button type="button" className={small} onClick={stopNotes}>
                    Cancel
                  </button>
                ) : notesShown ? (
                  <button type="button" className={small} onClick={() => setStoredNotes(null)}>
                    Clear
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={runNotes}
                  disabled={!canWriteNotes || notesBusy}
                  className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg hover:opacity-90 disabled:opacity-50"
                >
                  {notesBusy ? "Writing…" : notesShown ? "Write again" : "Write notes"}
                </button>
              </div>
            </div>
            <p className="mt-1.5 text-xs text-muted">
              The badges are computed. Claude Opus 5.5 adds one line of advice per mix.{" "}
              {presetHint(isLive, demo.notesPlaceholder)}
            </p>
            <div aria-live="polite" className="text-xs">
              {!isLive && !isDefaultSet && !tooLongForNotes && set.stats.mixes > 0 && (
                <p className="mt-2 text-fg">
                  Without a key, notes exist only for the opening sample set.{" "}
                  <button type="button" className="underline underline-offset-2" onClick={resetAll}>
                    Go back to it
                  </button>{" "}
                  or{" "}
                  <button
                    type="button"
                    className="underline underline-offset-2"
                    onClick={openKeyModal}
                  >
                    add a key
                  </button>{" "}
                  to write notes for this set.
                </p>
              )}
              {tooLongForNotes && (
                <p className="mt-2 text-fg">Notes cover sets of up to {MAX_SET_TRACKS} tracks.</p>
              )}
              {!notesBusy && notesError && (
                <p role="alert" className="mt-2 text-sm text-danger">
                  {notesError.kind === "refusal" ? "Declined: " : ""}
                  {notesError.message}
                </p>
              )}
              {notesShown && storedNotes && (
                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
                  <span className="rounded-sm border border-border px-1.5 py-0.5 text-fg">
                    {sourceLabel(storedNotes.meta)}
                  </span>
                  {ruleNotes > 0 && (
                    <span>
                      {ruleNotes} of {storedNotes.notes.length} written by the app&apos;s rules
                      after failing the fact check
                    </span>
                  )}
                  <CostMeter meta={storedNotes.meta} />
                </p>
              )}
            </div>
          </div>

          <div className="set-scroll mt-3">
            <SetList
              set={set}
              notes={notes}
              activeId={activeId}
              selectedId={selectedId}
              onHover={setHoverId}
              onSelect={select}
            />
          </div>
        </section>

        <div className="min-w-0 [grid-area:stats]">
          <StatsCard result={computed.result} set={set} ms={computed.ms} />
        </div>
      </div>
    </div>
  );
}
