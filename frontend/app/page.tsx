import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10 text-slate-900">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-5xl flex-col justify-center">
        <section className="rounded-3xl border border-slate-200 bg-white p-10 shadow-sm sm:p-12">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Smartalyze</p>
          <h1 className="mt-4 max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
            Clean data faster, spot issues early, and get simple analysis in one place.
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-600">
            Smartalyze helps non-technical users upload datasets, inspect quality problems, and prepare data for reliable analysis.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link className="rounded-xl bg-slate-900 px-5 py-3 text-center font-medium text-white transition hover:bg-slate-800" href="/register">
              Get Started
            </Link>
            <Link className="rounded-xl border border-slate-300 px-5 py-3 text-center font-medium transition hover:bg-slate-50" href="/login">
              Login
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
