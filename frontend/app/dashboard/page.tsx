"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Dataset, getCurrentUser, listDatasets, uploadDataset } from "@/lib/api";
import { clearStoredToken, getStoredToken } from "@/lib/auth";

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
      setMessage("Choose a file before uploading.");
      return;
    }

    setUploading(true);
    setMessage("");

    try {
      await uploadDataset(file, description, currentToken);
      setFile(null);
      setDescription("");
      await refreshDatasets();
      setMessage("Dataset uploaded successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed.");
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
      <main className="min-h-screen bg-slate-100 px-4 py-10 text-slate-900">
        <div className="mx-auto max-w-6xl">Loading dashboard...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Smartalyze</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="text-sm text-slate-600">Welcome{username ? `, ${username}` : ""}. Manage uploads and review datasets.</p>
          </div>
          <button
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium transition hover:bg-slate-50"
            type="button"
            onClick={handleLogout}
          >
            Logout
          </button>
        </header>

        <section className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Upload dataset</h2>
            <p className="mt-1 text-sm text-slate-600">Accept CSV, Excel, or JSON files.</p>

            <form className="mt-5 space-y-4" onSubmit={handleUpload}>
              <label className="block">
                <span className="mb-2 block text-sm font-medium">File</span>
                <input
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
                  type="file"
                  accept=".csv,.xlsx,.xls,.json"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  required
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium">Description</span>
                <textarea
                  className="min-h-24 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-slate-900"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Optional notes about the dataset"
                />
              </label>

              {message ? <p className="text-sm text-slate-600">{message}</p> : null}

              <button
                className="w-full rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                type="submit"
                disabled={uploading}
              >
                {uploading ? "Uploading..." : "Upload dataset"}
              </button>
            </form>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Datasets</h2>
                <p className="mt-1 text-sm text-slate-600">Recent uploads and metadata summary.</p>
              </div>
              <Link className="text-sm font-medium text-slate-900 underline" href="/register">
                Create another account
              </Link>
            </div>

            <div className="mt-5 grid gap-4">
              {datasets.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-600">
                  No datasets uploaded yet.
                </div>
              ) : (
                datasets.map((dataset) => (
                  <article key={dataset.id} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <h3 className="font-semibold">{dataset.original_filename}</h3>
                      <div className="flex items-center gap-3">
                        <span className="text-xs uppercase tracking-[0.2em] text-slate-500">{dataset.file_format}</span>
                        <Link className="text-sm font-medium text-slate-900 underline" href={`/dataset/${dataset.id}`}>
                          Open workspace
                        </Link>
                      </div>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">{dataset.description ?? "No description provided."}</p>
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="text-slate-500">Rows</dt>
                        <dd className="font-medium">{dataset.row_count ?? "-"}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Columns</dt>
                        <dd className="font-medium">{dataset.column_count ?? "-"}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Size</dt>
                        <dd className="font-medium">{Math.round(dataset.size_bytes / 1024)} KB</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Created</dt>
                        <dd className="font-medium">{new Date(dataset.created_at).toLocaleDateString()}</dd>
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
