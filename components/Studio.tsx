"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArcEditor } from "@/components/ArcEditor";
import { ArcPrompt, type AppliedArc } from "@/components/ArcPrompt";
import { CamelotWheel, PathLegend, WheelLegend } from "@/components/CamelotWheel";
import { CostMeter } from "@/components/kit/CostMeter";
import { useKey } from "@/components/kit/KeyProvider";
import { Intro } from "@/components/Intro";
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
  ARC_PRESETS,
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

/** Where the guided first-screen demo is: reading the description, re-planning, or finished. */
type TourPhase = "reading" | "planning" | "done" | "failed";

/** The preset the first-screen button plays: a description turned into a plan, then a re-planned set. */
const TOUR_PRESET = ARC_PRESETS[0];

const TOUR_LABEL = "Watch it plan a 3-hour set";

/** A short pause on the first step of the guided demo, so its narration can be read. */
const TOUR_READ_MS = 900;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  // The latest plan, for code that resumes after an await (a model reply, a file read) and must
  // not overwrite something the visitor changed in the meantime.
  const planRef = useRef<Plan>(DEFAULT_PLAN);
  const [computed, setComputed] = useState<Computed>(defaultComputed);
  const [busy, setBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const crateCounter = useRef(0);

  const [arcBusy, setArcBusy] = useState(false);
  const [arcError, setArcError] = useState<ApiFailure | null>(null);
  const [appliedArc, setAppliedArc] = useState<AppliedArc | null>(null);
  // Bumped on Reset so the description box starts again empty.
  const [promptVersion, setPromptVersion] = useState(0);
  const arcAbort = useRef<AbortController | null>(null);

  const [notesBusy, setNotesBusy] = useState(false);
  const [notesError, setNotesError] = useState<ApiFailure | null>(null);
  const [storedNotes, setStoredNotes] = useState<StoredNotes | null>(null);
  const notesAbort = useRef<AbortController | null>(null);

  const [tour, setTour] = useState<TourPhase | null>(null);
  // Bumped whenever the visitor changes something themselves, which ends the guided demo.
  const tourRun = useRef(0);
  // The guided demo's arc request while it is in flight, so a change by the visitor can stop it.
  const tourArc = useRef<AbortController | null>(null);

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

  /** Changes some fields of the latest plan and re-plans. */
  function change(patch: Partial<Plan>, fromTour = false): Promise<boolean> {
    return applyPlan({ ...planRef.current, ...patch }, fromTour);
  }

  /**
   * Every change to the plan ends up here: it updates the plan and re-runs the search.
   * Resolves true once the new set is on screen, false if a later change replaced it.
   */
  function applyPlan(next: Plan, fromTour = false): Promise<boolean> {
    if (!fromTour) endTour();
    planRef.current = next;
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
      return Promise.resolve(true);
    }
    const input = toInput(next);
    setBusy(true);
    return run(input).then((output) => {
      if (!output) return false;
      setComputed({ crateUid: next.crate.uid, input, result: output.result, ms: output.ms });
      setBusy(false);
      return true;
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
    change({
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
    // An error belongs to the set it was written for; it must not outlive a change to the set.
    setNotesError(null);
  }

  /**
   * Turns a description into an arc and re-plans the set to it. `tourId` is set when the
   * guided first-screen demo makes the request. Resolves true once the new set is on screen.
   */
  async function runArc(
    body: { demoId?: string; description: string },
    tourId?: number,
  ): Promise<boolean> {
    // A request the visitor makes themselves replaces the guided demo.
    if (tourId === undefined) endTour();
    stopArc();
    const controller = new AbortController();
    arcAbort.current = controller;
    if (tourId !== undefined) tourArc.current = controller;
    setArcBusy(true);
    setArcError(null);
    const [response] = await Promise.all([
      callApi<ArcPlan>("/api/arc", body, apiKey, controller.signal),
      tourId === undefined ? null : sleep(TOUR_READ_MS),
    ]);
    if (controller.signal.aborted) return false;
    arcAbort.current = null;
    if (tourArc.current === controller) tourArc.current = null;
    setArcBusy(false);
    if (!response.ok) {
      setArcError(response.error);
      return false;
    }
    // Checked again in the browser: the curve is only applied if it is a valid arc.
    const arc = validateArc(response.data);
    if (!arc) {
      setArcError({ kind: "server", message: "The curve that came back was not usable." });
      return false;
    }
    const targetMin =
      arc.durationMinutes === null
        ? planRef.current.targetMin
        : Math.min(MAX_TARGET_MIN, Math.max(MIN_TARGET_MIN, arc.durationMinutes));
    setAppliedArc({
      description: body.description,
      summary: arc.summary,
      durationMinutes: arc.durationMinutes === null ? null : targetMin,
      meta: response.meta,
    });
    const fromTour = tourId !== undefined && tourId === tourRun.current;
    if (fromTour) setTour("planning");
    return change({ arc: arc.points, targetMin }, fromTour);
  }

  /** Ends the guided demo: its narration goes back to the invitation and its request, if any, stops. */
  function endTour() {
    tourRun.current += 1;
    setTour(null);
    if (tourArc.current) {
      if (arcAbort.current === tourArc.current) stopArc();
      else tourArc.current.abort();
      tourArc.current = null;
    }
  }

  /** The first-screen button: play one arc preset with narration, or start over once it is done. */
  async function playTour() {
    if (tour === "done") {
      resetAll();
      return;
    }
    const id = ++tourRun.current;
    setTour("reading");
    const shown = await runArc(
      { demoId: TOUR_PRESET.demoId, description: TOUR_PRESET.description },
      id,
    );
    if (id !== tourRun.current) return;
    setTour(shown ? "done" : "failed");
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
    setPromptVersion((version) => version + 1);
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

  const tourBusy = tour === "reading" || tour === "planning";
  const narration =
    tour === "reading"
      ? `Turning “${TOUR_PRESET.description}” into an energy plan…`
      : tour === "planning" || (tour === "done" && busy)
        ? `Choosing from the ${tracks.length} tracks and ordering them to follow the new plan…`
        : tour === "done"
          ? `Done: a ${formatLength(targetSec)} plan from one sentence. Code picked ${set.entries.length} of ${tracks.length} tracks; ${set.stats.cleanMixes} of ${set.stats.mixes} changes blend smoothly.`
          : tour === "failed"
            ? `That did not work: ${arcError?.message ?? "the plan could not be applied. Try again."}`
            : "One click: a sentence describing the night becomes an energy plan, and the set re-plans to follow it.";
  const narrationNote =
    tour === null || tour === "failed" || isLive
      ? null
      : demo.arcPlaceholder
        ? "Claude's part here is a pre-written example."
        : "Claude's part here replays a recorded run.";

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-3 pb-4 pt-3 sm:px-5">
      <Intro
        crateSize={SAMPLE_TRACKS.length}
        setLength={formatLength(DEFAULT_TARGET_MIN * 60)}
        actionLabel={tourBusy ? "Planning…" : tour === "done" ? "Start over" : TOUR_LABEL}
        actionBusy={tourBusy}
        onAction={() => void playTour()}
        narration={narration}
        narrationNote={narrationNote}
      />

      <div className="studio-grid">
        <div className="min-w-0 [grid-area:tools]">
          <Toolbar
            crateName={plan.crate.name}
            trackCount={plan.crate.tracks.length}
            isSample={plan.crate.isSample}
            report={plan.crate.report}
            importError={importError}
            onImport={handleImport}
            onUseSample={() => {
              setImportError(null);
              change({ crate: SAMPLE_CRATE });
            }}
            onDownloadSample={() =>
              download("harmonic-sample-crate.csv", SAMPLE_CRATE_CSV, "text/csv")
            }
            targetMin={plan.targetMin}
            onTargetMin={(targetMin) => change({ targetMin })}
            weights={plan.weights}
            onWeights={(weights) => change({ weights })}
            seed={plan.seed}
            busy={busy}
            onOptimize={() => change({ seed: planRef.current.seed + 1 })}
            canReset={!isDefaultPlan(plan)}
            onReset={resetAll}
          />
        </div>

        <section
          aria-labelledby="wheel-title"
          className={`${card} min-w-0 p-2 [grid-area:wheel] sm:p-3`}
        >
          <div className="px-2 pb-1 pt-1">
            <h2 id="wheel-title" className="text-sm font-semibold">
              Key wheel{" "}
              <span className="font-normal text-muted">(DJs call it the Camelot wheel)</span>
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              The 24 musical keys in a circle. Neighbouring keys blend smoothly.
            </p>
            <WheelLegend className="mt-1.5" />
          </div>
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
                bottom: ["better mixing score", "than a random order"],
              }}
            />
          </div>
          <PathLegend className="justify-center px-2" />
          <p className="px-2 pb-1 pt-1.5 text-center text-xs text-muted">
            Point at or tap a song to see every track it blends into. The centre compares this
            order&apos;s mixing score with random orders of the same tracks.
          </p>
        </section>

        <section aria-labelledby="arc-title" className={`${card} min-w-0 p-4 [grid-area:arc]`}>
          <div className="mb-2">
            <h2 id="arc-title" className="text-sm font-semibold">
              Energy arc
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              How intense the music should be over the set, from 1 (calm) to 10 (peak). Drag a point
              and the set re-plans.
            </p>
          </div>
          <ArcEditor
            arc={plan.arc}
            onChange={(arc) => {
              // Dragging redraws the curve live; the search waits for the drop.
              planRef.current = { ...planRef.current, arc };
              setPlan(planRef.current);
            }}
            onCommit={(arc) => {
              // A hand edit replaces whatever description the curve came from.
              setAppliedArc(null);
              change({ arc });
            }}
            set={set}
            targetSec={targetSec}
            activeId={activeId}
            onHover={setHoverId}
          />
          <ArcPrompt
            key={promptVersion}
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
              <p className="mt-0.5 text-xs text-muted">
                In play order. The badges show how each track blends into the next: key, tempo,
                energy.
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
              <h3 className="text-sm font-medium">Mixing tips</h3>
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
                  className="rounded-md border border-accent/60 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-raised disabled:opacity-50"
                >
                  {notesBusy ? "Writing…" : notesShown ? "Write again" : "Write mixing tips"}
                </button>
              </div>
            </div>
            <p className="mt-1.5 text-xs text-muted">
              Code works out the badges; Claude Opus 5.5 adds one line of advice per mix.{" "}
              {presetHint(isLive, demo.notesPlaceholder)}
            </p>
            <div aria-live="polite" className="text-xs">
              {!isLive && !isDefaultSet && !tooLongForNotes && set.stats.mixes > 0 && (
                <p className="mt-2 text-fg">
                  Without a key, tips exist only for the opening sample set.{" "}
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
                  to write tips for this set.
                </p>
              )}
              {tooLongForNotes && (
                <p className="mt-2 text-fg">Tips cover sets of up to {MAX_SET_TRACKS} tracks.</p>
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
                  {!storedNotes.meta.placeholder && <CostMeter meta={storedNotes.meta} />}
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
