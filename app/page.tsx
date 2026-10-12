import { DemoBanner } from "@/components/kit/DemoBanner";
import { ThemeToggle } from "@/components/kit/ThemeToggle";
import { Logo } from "@/components/Logo";
import { Studio } from "@/components/Studio";
import arcFixtures from "@/fixtures/arc.json";
import notesFixtures from "@/fixtures/notes.json";
import { defaultRun } from "@/lib/defaults";
import type { FixtureStore } from "@/lib/demo";

/** True until every fixture in the store is a recorded run. Drives the wording in the UI. */
function stillPlaceholder(store: FixtureStore): boolean {
  const fixtures = Object.values(store);
  return fixtures.length === 0 || fixtures.some((fixture) => fixture.placeholder);
}

/**
 * The default set is optimized here, on the server, at build time. The search
 * is deterministic, so the page ships with the sample crate already planned and
 * the browser only runs the optimizer when the visitor changes something.
 */
export default function Home() {
  const initial = defaultRun();
  return (
    <>
      <DemoBanner aiRequired={false} />
      <header className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Logo />
          <h1 className="text-base font-semibold tracking-tight">Harmonic</h1>
          <p className="hidden truncate text-sm text-muted sm:block">
            Turn a crate into a harmonically mixed set that follows an energy arc.
          </p>
        </div>
        <ThemeToggle />
      </header>
      <main id="main" className="flex-1">
        <Studio
          initial={initial}
          demo={{
            arcPlaceholder: stillPlaceholder(arcFixtures as FixtureStore),
            notesPlaceholder: stillPlaceholder(notesFixtures as FixtureStore),
          }}
        />
      </main>
      <footer className="border-t border-border px-4 py-4 text-center text-xs text-muted">
        Built with Claude Code and Claude Opus 5.5.
      </footer>
    </>
  );
}
