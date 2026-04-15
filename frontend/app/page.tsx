import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-white text-slate-950">
      <section className="relative isolate overflow-hidden border-b border-indigo-100 bg-linear-to-b from-white via-indigo-50/30 to-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.14),transparent_28%),radial-gradient(circle_at_top_right,rgba(139,92,246,0.12),transparent_24%)]" />
        <div className="mx-auto flex min-h-[92vh] w-full max-w-6xl items-center px-4 py-10 sm:px-6 lg:px-8">
          <div className="relative grid w-full gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div>
              <div className="inline-flex items-center rounded-full border border-indigo-200 bg-white/90 px-4 py-2 text-sm font-medium text-indigo-700 shadow-sm backdrop-blur">
                Smartalyze for data cleaning and analysis
              </div>
              <h1 className="mt-6 max-w-3xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
                Clean datasets, find issues, and explore insights without feeling overwhelmed.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-700 sm:text-xl">
                Upload CSV, Excel, or JSON files, inspect data quality, and move through analysis in a simple workspace designed for non-technical users.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  className="rounded-xl bg-linear-to-r from-indigo-600 to-violet-600 px-6 py-3 text-center font-semibold text-white! shadow-lg shadow-indigo-200 transition hover:from-indigo-700 hover:to-violet-700"
                  href="/register"
                >
                  Sign Up
                </Link>
                <Link
                  className="rounded-xl border border-indigo-200 bg-white px-6 py-3 text-center font-semibold text-indigo-700! shadow-sm transition hover:bg-indigo-50"
                  href="/login"
                >
                  Login
                </Link>
              </div>

              <div className="mt-8 flex flex-wrap gap-3 text-sm text-slate-700">
                <span className="rounded-full border border-indigo-100 bg-white px-4 py-2 shadow-sm">Upload and preview</span>
                <span className="rounded-full border border-indigo-100 bg-white px-4 py-2 shadow-sm">Flexible workflow</span>
                <span className="rounded-full border border-indigo-100 bg-white px-4 py-2 shadow-sm">Version history</span>
              </div>
            </div>

            <div className="relative">
              <div className="rounded-3xl border border-indigo-100 bg-white p-6 text-slate-900 shadow-2xl shadow-indigo-100/80">
                <div className="flex items-center justify-between border-b border-indigo-100 pb-4">
                  <div>
                    <p className="text-sm uppercase tracking-[0.2em] text-indigo-500">Workspace preview</p>
                    <p className="mt-1 text-xl font-semibold">Dataset overview</p>
                  </div>
                  <div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                    Ready
                  </div>
                </div>

                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4">
                    <p className="text-sm text-slate-600">Issues detected</p>
                    <p className="mt-2 text-3xl font-semibold">3</p>
                    <p className="mt-1 text-sm text-slate-600">Missing values and duplicates</p>
                  </div>
                  <div className="rounded-2xl border border-indigo-100 bg-violet-50/70 p-4">
                    <p className="text-sm text-slate-600">Versions</p>
                    <p className="mt-2 text-3xl font-semibold">5</p>
                    <p className="mt-1 text-sm text-slate-600">Original and cleaned history</p>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-indigo-100 bg-white p-4">
                  <p className="text-sm font-medium text-indigo-500">Suggested next step</p>
                  <p className="mt-2 text-base text-slate-700">
                    Review the preview table, then choose cleaning, analysis, or aggregation directly from the dataset workspace.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-indigo-500!">Features</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Simple tools, organized around each dataset.</h2>
          <p className="mt-4 text-lg leading-8 text-slate-700">
            Smartalyze keeps the workflow light: upload once, then move between cleaning, analysis, aggregation, and prediction without being forced into a rigid pipeline.
          </p>
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-3xl border border-indigo-100 bg-white p-6 shadow-sm shadow-indigo-50">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-indigo-500!">1</p>
            <h3 className="mt-3 text-xl font-semibold">Upload and track</h3>
            <p className="mt-3 text-sm leading-7 text-slate-700">
              Upload datasets and keep them tied to the logged-in user with version history and action logs.
            </p>
          </article>
          <article className="rounded-3xl border border-indigo-100 bg-white p-6 shadow-sm shadow-indigo-50">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-indigo-500!">2</p>
            <h3 className="mt-3 text-xl font-semibold">Spot data issues</h3>
            <p className="mt-3 text-sm leading-7 text-slate-700">
              Get guidance on missing values, duplicates, and type patterns before deciding what to do next.
            </p>
          </article>
          <article className="rounded-3xl border border-indigo-100 bg-white p-6 shadow-sm shadow-indigo-50">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-indigo-500!">3</p>
            <h3 className="mt-3 text-xl font-semibold">Work any way you want</h3>
            <p className="mt-3 text-sm leading-7 text-slate-700">
              Clean, analyze, aggregate, or predict independently from the dataset workspace.
            </p>
          </article>
          <article className="rounded-3xl border border-indigo-100 bg-white p-6 shadow-sm shadow-indigo-50">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-indigo-500!">4</p>
            <h3 className="mt-3 text-xl font-semibold">Save versions</h3>
            <p className="mt-3 text-sm leading-7 text-slate-700">
              Keep a history of cleaned or derived results so you can compare and roll back later.
            </p>
          </article>
        </div>
      </section>

      <section className="border-t border-indigo-100 bg-linear-to-r from-indigo-50 via-white to-violet-50">
        <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_auto] lg:px-8">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-indigo-500!">Ready to begin</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">Open your first dataset and explore the workspace.</h2>
            <p className="mt-4 max-w-2xl text-slate-700">
              Start with a simple upload, then inspect the data and choose the next action when you are ready.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row lg:flex-col lg:justify-center">
            <Link className="rounded-xl bg-linear-to-r from-indigo-600 to-violet-600 px-6 py-3 text-center font-semibold text-white! shadow-lg shadow-indigo-200 transition hover:from-indigo-700 hover:to-violet-700" href="/register">
              Sign Up
            </Link>
            <Link className="rounded-xl border border-indigo-200 bg-white px-6 py-3 text-center font-semibold text-indigo-700! shadow-sm transition hover:bg-indigo-50" href="/login">
              Login
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-indigo-100 bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>Smartalyze</p>
          <p>AI-assisted data cleaning and analysis for simple, flexible workflows.</p>
        </div>
      </footer>
    </main>
  );
}
