import Link from "next/link";

const featureCards = [
  {
    title: "Data Cleaning",
    description: "Detect missing values, duplicates, and type issues before you make decisions.",
  },
  {
    title: "Data Analysis",
    description: "Review summaries and patterns to understand what your dataset is telling you.",
  },
  {
    title: "Aggregation",
    description: "Group and summarize data to spot trends across categories and segments.",
  },
  {
    title: "Predictive Insights",
    description: "Use simple machine learning workflows to explore basic predictions.",
  },
];

export default function Home() {
  return (
    <main className="bg-white">
      <section className="border-b border-slate-200 bg-linear-to-b from-white via-indigo-50/25 to-white">
        <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-8 lg:py-28">
          <div className="max-w-2xl">
            <p className="inline-flex rounded-full border border-indigo-200 bg-white px-4 py-2 text-sm font-medium text-indigo-700 shadow-sm">
              Smartalyze for clean, simple dataset work
            </p>
            <h1 className="mt-6 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
              Clean, Analyze, and Understand Your Data Easily
            </h1>
            <p className="mt-6 text-lg leading-8 text-slate-700 sm:text-xl">
              Smartalyze helps non-technical users upload datasets, inspect issues, clean data, and explore insights in one flexible workspace.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/register" className="rounded-xl bg-slate-950 px-6 py-3 text-center font-semibold text-white transition hover:bg-slate-800">
                Get Started
              </Link>
              <a href="#about" className="rounded-xl border border-slate-200 bg-white px-6 py-3 text-center font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">
                Learn More
              </a>
            </div>
          </div>

          <div className="rounded-3xl border border-indigo-100 bg-white p-6 shadow-xl shadow-indigo-100/60">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div>
                <p className="text-sm font-medium uppercase tracking-[0.2em] text-indigo-500">Workspace preview</p>
                <p className="mt-1 text-xl font-semibold text-slate-950">Dataset overview</p>
              </div>
              <div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Ready</div>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4">
                <p className="text-sm text-slate-600">Cleaning</p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">Optional</p>
                <p className="mt-1 text-sm text-slate-600">Run it when you need it, not on a fixed path.</p>
              </div>
              <div className="rounded-2xl border border-indigo-100 bg-violet-50/70 p-4">
                <p className="text-sm text-slate-600">Versions</p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">Tracked</p>
                <p className="mt-1 text-sm text-slate-600">Keep a history of dataset changes.</p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-indigo-100 bg-white p-4">
              <p className="text-sm font-medium text-indigo-600">How it works</p>
              <p className="mt-2 text-sm leading-7 text-slate-700">
                Upload a dataset, review the workspace, detect issues, and decide whether to clean, analyze, aggregate, or predict next.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="about" className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="max-w-3xl">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-indigo-500">About</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">What Smartalyze does</h2>
          <p className="mt-4 text-lg leading-8 text-slate-700">
            Smartalyze is built to help non-technical users work with datasets in a structured but flexible way. Each dataset gets its own workspace, and users can choose the next action without being forced through a fixed pipeline.
          </p>
        </div>
      </section>

      <section id="features" className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-indigo-500">Features</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">Core tools for working with data</h2>
            <p className="mt-4 text-lg leading-8 text-slate-700">
              The landing page introduces the main capabilities of Smartalyze so users know exactly what to expect before they sign in.
            </p>
          </div>

          <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
            {featureCards.map((feature) => (
              <article key={feature.title} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-xl font-semibold text-slate-950">{feature.title}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-700">{feature.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="contact" className="border-t border-slate-200 bg-white">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_0.9fr] lg:px-8">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-indigo-500">Contact</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">Keep it simple</h2>
            <p className="mt-4 text-lg leading-8 text-slate-700">
              For now, contact can stay lightweight. A basic email line is enough until you want a backend form.
            </p>
            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Email</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">smartalyze.project@example.com</p>
            </div>
          </div>

          <form className="rounded-3xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
            <h3 className="text-xl font-semibold text-slate-950">Send a message</h3>
            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Name</span>
                <input className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-slate-900" placeholder="Your name" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Email</span>
                <input className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-slate-900" placeholder="you@example.com" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Message</span>
                <textarea className="min-h-32 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-slate-900" placeholder="Write your message here" />
              </label>
              <button type="button" className="w-full rounded-xl bg-slate-950 px-4 py-3 font-semibold text-white transition hover:bg-slate-800">
                Send
              </button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
