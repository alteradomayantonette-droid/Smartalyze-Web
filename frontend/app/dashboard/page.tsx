"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Dataset, getCurrentUser, listDatasets, uploadDataset } from "@/lib/api";
import { clearStoredToken, getStoredToken } from "@/lib/auth";

type FeedbackTone = "neutral" | "success" | "warning" | "error";

function getFeedbackClasses(tone: FeedbackTone): string {
  switch (tone) {
    case "success":
      return "border-green-200 bg-green-50 text-green-800";
    case "warning":
      return "border-yellow-200 bg-yellow-50 text-yellow-800";
    case "error":
      return "border-red-200 bg-red-50 text-red-800";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

function getDatasetStatus(dataset: Dataset): { label: string; classes: string } {
  const missingCells = Number(dataset.summary_json?.missing_cells ?? 0);
  const duplicateRows = Number(dataset.summary_json?.duplicate_rows ?? 0);

  if (duplicateRows > 0) {
    return { label: "Needs review", classes: "bg-red-100 text-red-700" };
  }

  if (missingCells > 0) {
    return { label: "Incomplete", classes: "bg-yellow-100 text-yellow-700" };
  }

  return { label: "Clean", classes: "bg-green-100 text-green-700" };
}

export default function DashboardPage() {
  const router = useRouter();
  const [username, setUsername] = useState<string | null>(null);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<FeedbackTone>("neutral");

  function setFeedback(text: string, tone: FeedbackTone = "neutral") {
    setMessage(text);
    setMessageTone(tone);
  }

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setToken(token);

    Promise.all([getCurrentUser(token), listDatasets(token)])
      .then(([user, datasetList]) => {
        setUsername(user.username);
        setDatasets(datasetList);
      })
      .catch(() => {
        clearStoredToken();
        router.replace("/login");
      })
      .finally(() => setLoading(false));
  }, [router]);

  async function refreshDatasets() {
    if (!token) {
      return;
    }
    const datasetList = await listDatasets(token);
    setDatasets(datasetList);
  }

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const currentToken = token ?? getStoredToken();
    if (!currentToken || !file) {
      setFeedback("Choose a file before uploading.", "warning");
      return;
    }

    setUploading(true);
    setFeedback("");

    try {
      await uploadDataset(file, description, currentToken);
      setFile(null);
      setDescription("");
      await refreshDatasets();
      setFeedback("Dataset uploaded successfully.", "success");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Upload failed.", "error");
    } finally {
      setUploading(false);
    }
  }

  function handleLogout() {
    clearStoredToken();
    router.replace("/login");
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
        <div className="mx-auto max-w-6xl">Loading dashboard...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-indigo-500">Smartalyze</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="text-sm text-slate-600">Welcome{username ? `, ${username}` : ""}. Manage uploads and review datasets.</p>
          </div>
          <button
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            type="button"
            onClick={handleLogout}
          >
            Logout
          </button>
        </header>

        <section className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Upload dataset</h2>
            <p className="mt-1 text-sm text-slate-600">Accept CSV, Excel, or JSON files.</p>

            <form className="mt-5 space-y-4" onSubmit={handleUpload}>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-900">File</span>
                <input
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
                  type="file"
                  accept=".csv,.xlsx,.xls,.json"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  required
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-900">Description</span>
                <textarea
                  className="min-h-24 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-indigo-500"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Optional notes about the dataset"
                />
              </label>

              {message ? <p className={`rounded-xl border px-3 py-2 text-sm ${getFeedbackClasses(messageTone)}`}>{message}</p> : null}

              <button
                className="w-full rounded-xl bg-indigo-600 px-4 py-3 font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-70"
                type="submit"
                disabled={uploading}
              >
                {uploading ? "Uploading..." : "Upload Dataset"}
              </button>
            </form>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Datasets</h2>
                <p className="mt-1 text-sm text-slate-600">Recent uploads and metadata summary.</p>
              </div>
            </div>

            <div className="mt-5 grid gap-4">
              {datasets.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
                  No datasets uploaded yet.
                </div>
              ) : (
                datasets.map((dataset) => (
                  <article key={dataset.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-3">
                        <h3 className="font-semibold text-slate-950">{dataset.original_filename}</h3>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${getDatasetStatus(dataset).classes}`}>
                          {getDatasetStatus(dataset).label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs uppercase tracking-[0.2em] text-slate-500">
                          {dataset.file_format}
                        </span>
                        <Link className="text-sm font-medium text-indigo-700 underline decoration-indigo-300 underline-offset-4" href={`/dataset/${dataset.id}`}>
                          Open workspace
                        </Link>
                      </div>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">{dataset.description ?? "No description provided."}</p>
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <dt className="text-slate-500">Rows</dt>
                        <dd className="font-medium text-slate-950">{dataset.row_count ?? "-"}</dd>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <dt className="text-slate-500">Columns</dt>
                        <dd className="font-medium text-slate-950">{dataset.column_count ?? "-"}</dd>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <dt className="text-slate-500">Size</dt>
                        <dd className="font-medium text-slate-950">{Math.round(dataset.size_bytes / 1024)} KB</dd>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <dt className="text-slate-500">Created</dt>
                        <dd className="font-medium text-slate-950">{new Date(dataset.created_at).toLocaleDateString()}</dd>
                      </div>
                    </dl>
                  </article>
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
