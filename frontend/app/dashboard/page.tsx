"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Dataset, deleteDataset, getCurrentUser, listDatasets, uploadDataset } from "@/lib/api";
import { clearStoredToken, getStoredToken } from "@/lib/auth";

type FeedbackTone = "neutral" | "success" | "warning" | "error";
type DashboardIssueType = "missing" | "duplicate" | "invalid";

type DashboardIssueItem = {
  id: string;
  datasetId: number;
  datasetName: string;
  type: DashboardIssueType;
  label: string;
  count: number;
  href: string;
  classes: string;
};

type SummaryCardProps = {
  title: string;
  value: string;
  detail: string;
  classes: string;
  accent: string;
};

function SummaryCard({ title, value, detail, classes, accent }: SummaryCardProps) {
  return (
    <article className={`rounded-3xl border bg-white p-5 shadow-sm ${classes}`}>
      <div className={`mb-4 h-1.5 w-16 rounded-full ${accent}`} />
      <p className="text-sm font-medium text-slate-600">{title}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-2 text-sm text-slate-600">{detail}</p>
    </article>
  );
}

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

function getNumericSummaryValue(summary: Record<string, unknown> | null | undefined, keys: string[]): number {
  for (const key of keys) {
    const value = summary?.[key];
    const numericValue = typeof value === "number" ? value : Number(value ?? 0);
    if (Number.isFinite(numericValue) && numericValue > 0) {
      return numericValue;
    }
  }

  return 0;
}

function getDatasetIssueItems(dataset: Dataset): DashboardIssueItem[] {
  const summary = dataset.summary_json ?? {};
  const issues: DashboardIssueItem[] = [];
  const missingCount = getNumericSummaryValue(summary, ["missing_cells", "missing_values"]);
  const duplicateCount = getNumericSummaryValue(summary, ["duplicate_rows", "duplicates"]);
  const invalidCount = getNumericSummaryValue(summary, ["invalid_values", "invalid_rows", "invalid_data_types", "type_issues"]);

  if (missingCount > 0) {
    issues.push({
      id: `${dataset.id}-missing`,
      datasetId: dataset.id,
      datasetName: dataset.original_filename,
      type: "missing",
      label: "Missing values",
      count: missingCount,
      href: `/dataset/${dataset.id}`,
      classes: "border-yellow-200 bg-yellow-50 text-yellow-800",
    });
  }

  if (duplicateCount > 0) {
    issues.push({
      id: `${dataset.id}-duplicates`,
      datasetId: dataset.id,
      datasetName: dataset.original_filename,
      type: "duplicate",
      label: "Duplicate rows",
      count: duplicateCount,
      href: `/dataset/${dataset.id}`,
      classes: "border-red-200 bg-red-50 text-red-800",
    });
  }

  if (invalidCount > 0) {
    issues.push({
      id: `${dataset.id}-invalid`,
      datasetId: dataset.id,
      datasetName: dataset.original_filename,
      type: "invalid",
      label: "Invalid values",
      count: invalidCount,
      href: `/dataset/${dataset.id}`,
      classes: "border-orange-200 bg-orange-50 text-orange-800",
    });
  }

  return issues;
}

function getHealthScore(dataset: Dataset): { score: number; label: "Good" | "Fair" | "Needs Work"; classes: string } {
  const summary = dataset.summary_json ?? {};
  const rowCount = dataset.row_count ?? 0;
  const missingCells = Number(summary.missing_cells ?? 0);
  const duplicateRows = Number(summary.duplicate_rows ?? 0);
  const totalCells = rowCount * (dataset.column_count ?? 1) || 1;
  const missingRate = missingCells / totalCells;
  const dupRate = rowCount > 0 ? duplicateRows / rowCount : 0;
  const score = Math.round((1 - missingRate) * 0.6 * 100 + (1 - dupRate) * 0.4 * 100);
  if (score >= 80) return { score, label: "Good", classes: "bg-green-100 text-green-700" };
  if (score >= 50) return { score, label: "Fair", classes: "bg-yellow-100 text-yellow-700" };
  return { score, label: "Needs Work", classes: "bg-red-100 text-red-700" };
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function DashboardPage() {
  const router = useRouter();
  const [username, setUsername] = useState<string | null>(null);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<FeedbackTone>("neutral");
  const [deleteTarget, setDeleteTarget] = useState<Dataset | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);

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

  async function refreshDatasets(currentToken?: string) {
    const effectiveToken = currentToken ?? token;
    if (!effectiveToken) {
      return;
    }

    const datasetList = await listDatasets(effectiveToken);
    setDatasets(datasetList);
  }

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0] ?? null;
    if (!selectedFile) {
      return;
    }

    const currentToken = token ?? getStoredToken();
    if (!currentToken) {
      setFeedback("You need to be logged in to upload.", "warning");
      return;
    }

    setUploading(true);
    setFeedback("");

    try {
      await uploadDataset(selectedFile, "Dashboard upload", currentToken);
      event.target.value = "";
      await refreshDatasets(currentToken);
      setFeedback("Dataset uploaded successfully.", "success");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Upload failed.", "error");
    } finally {
      setUploading(false);
    }
  }

  function openDeleteModal(dataset: Dataset) {
    setDeleteTarget(dataset);
  }

  function closeDeleteModal() {
    if (deleting) {
      return;
    }
    setDeleteTarget(null);
  }

  async function handleConfirmDelete() {
    const currentToken = token ?? getStoredToken();
    if (!currentToken || !deleteTarget) {
      return;
    }

    setDeleting(true);
    setFeedback("");

    try {
      await deleteDataset(deleteTarget.id, currentToken);
      await refreshDatasets(currentToken);
      setFeedback(`Deleted ${deleteTarget.original_filename}.`, "success");
      setDeleteTarget(null);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Delete failed.", "error");
    } finally {
      setDeleting(false);
    }
  }

  async function handleLoadSample() {
    const currentToken = token ?? getStoredToken();
    if (!currentToken) {
      setFeedback("You need to be logged in to upload.", "warning");
      return;
    }
    setLoadingSample(true);
    setFeedback("");
    try {
      const res = await fetch("/sample-dataset.csv");
      const blob = await res.blob();
      const file = new File([blob], "sample-dataset.csv", { type: "text/csv" });
      await uploadDataset(file, "Sample dataset with messy sales data", currentToken);
      await refreshDatasets(currentToken);
      setFeedback("Sample dataset loaded successfully.", "success");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not load sample.", "error");
    } finally {
      setLoadingSample(false);
    }
  }

  function handleLogout() {
    clearStoredToken();
    router.replace("/login");
  }

  const datasetsByLatest = [...datasets].sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
  const visibleDatasets = datasetsByLatest.length > 0 ? datasetsByLatest : [];
  const allIssues = visibleDatasets.flatMap((dataset) => getDatasetIssueItems(dataset));
  const datasetsWithWarnings = visibleDatasets.filter((dataset) => getDatasetIssueItems(dataset).length > 0).length;
  const datasetsWithNoIssues = Math.max(visibleDatasets.length - datasetsWithWarnings, 0);
  const totalRows = visibleDatasets.reduce((sum, dataset) => sum + Number(dataset.row_count ?? 0), 0);
  const recentDataset = visibleDatasets[0] ?? null;

  const activityData = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const label = d.toLocaleDateString(undefined, { weekday: "short" });
    const count = datasets.filter((ds) => new Date(ds.created_at).toDateString() === d.toDateString()).length;
    return { label, count };
  });
  const activityMax = Math.max(...activityData.map((d) => d.count), 1);

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
        <div className="mx-auto max-w-6xl">Loading dashboard...</div>
      </main>
    );
  }

  const summaryCards = [
    {
      title: "Total datasets",
      value: String(visibleDatasets.length),
      detail: "All uploads in one place.",
      classes: "border-indigo-100",
      accent: "bg-indigo-600",
    },
    {
      title: "Datasets with no issues",
      value: String(datasetsWithNoIssues),
      detail: "No missing values or duplicates detected.",
      classes: "border-green-100",
      accent: "bg-green-500",
    },
    {
      title: "Datasets with warnings",
      value: String(datasetsWithWarnings),
      detail: "Items that need quick review.",
      classes: "border-amber-100",
      accent: "bg-yellow-400",
    },
    {
      title: "Total rows",
      value: totalRows > 0 ? totalRows.toLocaleString() : "0",
      detail: "Across the visible datasets.",
      classes: "border-slate-200",
      accent: "bg-sky-500",
    },
  ];

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-indigo-500">Smartalyze</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="text-sm text-slate-600">Welcome{username ? `, ${username}` : ""}. Review your datasets and warnings at a glance.</p>
          </div>
          <button
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            type="button"
            onClick={handleLogout}
          >
            Logout
          </button>
        </header>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-indigo-500">Quick actions</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">Fast access to your workspace</h2>
              <p className="mt-1 text-sm text-slate-600">Upload a new dataset or jump straight back into the latest one.</p>
            </div>

            <div className="flex flex-wrap gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700">
                <input className="hidden" type="file" accept=".csv,.xlsx,.xls,.json" onChange={handleUpload} />
                <span>{uploading ? "Uploading..." : "Upload Dataset"}</span>
              </label>
              <button
                type="button"
                className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handleLoadSample}
                disabled={loadingSample}
              >
                {loadingSample ? "Loading..." : "Load Sample Dataset"}
              </button>
              {recentDataset ? (
                <Link className="rounded-xl border border-indigo-200 bg-indigo-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-indigo-500" href={`/dataset/${recentDataset.id}`}>
                  Open Recent Dataset
                </Link>
              ) : (
                <button className="rounded-xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm font-medium text-slate-400" type="button" disabled>
                  Open Recent Dataset
                </button>
              )}
            </div>
          </div>

          {message ? <p className={`mt-5 rounded-2xl border px-4 py-3 text-sm ${getFeedbackClasses(messageTone)}`}>{message}</p> : null}
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map((card) => (
            <SummaryCard key={card.title} title={card.title} value={card.value} detail={card.detail} classes={card.classes} accent={card.accent} />
          ))}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-indigo-500">Activity</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">Uploads — last 7 days</h2>
          <div className="mt-5 flex h-24 items-end gap-2">
            {activityData.map(({ label, count }) => (
              <div key={label} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-xs font-medium text-slate-600">{count > 0 ? count : ""}</span>
                <div
                  className="w-full rounded-t-lg bg-indigo-500 transition-all"
                  style={{ height: `${Math.max((count / activityMax) * 100, count > 0 ? 8 : 2)}%` }}
                />
                <span className="text-xs text-slate-500">{label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_0.9fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium uppercase tracking-[0.2em] text-indigo-500">Warnings</p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">Issues across datasets</h2>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{allIssues.length} issues</span>
            </div>

            <div className="mt-5 space-y-3">
              {allIssues.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
                  No warnings found. Your datasets look clean.
                </div>
              ) : (
                allIssues.map((issue) => (
                  <Link key={issue.id} href={issue.href} className={`block rounded-2xl border p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${issue.classes}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${
                              issue.type === "missing" ? "bg-yellow-500" : issue.type === "duplicate" ? "bg-red-500" : "bg-orange-500"
                            }`}
                          />
                          <p className="font-semibold text-slate-950">{issue.datasetName}</p>
                        </div>
                        <p className="mt-1 text-sm font-medium text-slate-700">{issue.label}</p>
                        <p className="mt-1 text-xs text-slate-500">Open the dataset workspace to review this issue.</p>
                      </div>
                      <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-slate-700">{issue.count}</span>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium uppercase tracking-[0.2em] text-indigo-500">Dataset list</p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">Your datasets</h2>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {visibleDatasets.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
                  No datasets uploaded yet. Use Upload Dataset to add your first file.
                </div>
              ) : (
                visibleDatasets.map((dataset) => {
                  const issueCount = getDatasetIssueItems(dataset).length;
                  const health = getHealthScore(dataset);

                  return (
                    <article key={dataset.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold text-slate-950">{dataset.original_filename}</h3>
                            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${health.classes}`}>
                              {health.label} · {health.score}
                            </span>
                          </div>
                          <p className="text-sm text-slate-600">{dataset.description ?? "No description provided."}</p>
                        </div>

                        <div className="flex items-center gap-3">
                          <Link className="text-sm font-medium text-indigo-700 underline decoration-indigo-300 underline-offset-4" href={`/dataset/${dataset.id}`}>
                            Open workspace
                          </Link>
                          <button
                            className="text-sm font-medium text-red-700 underline decoration-red-300 underline-offset-4"
                            type="button"
                            onClick={() => openDeleteModal(dataset)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>

                      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                        <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3">
                          <dt className="text-slate-500">Rows</dt>
                          <dd className="font-medium text-slate-950">{dataset.row_count ?? "-"}</dd>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white p-3">
                          <dt className="text-slate-500">Columns</dt>
                          <dd className="font-medium text-slate-950">{dataset.column_count ?? "-"}</dd>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white p-3">
                          <dt className="text-slate-500">Last updated</dt>
                          <dd className="font-medium text-slate-950">{formatDate(dataset.created_at)}</dd>
                        </div>
                        <div className={`rounded-xl border p-3 ${issueCount > 0 ? "border-yellow-100 bg-yellow-50" : "border-green-100 bg-green-50"}`}>
                          <dt className="text-slate-500">Issues</dt>
                          <dd className={`font-medium ${issueCount > 0 ? "text-yellow-800" : "text-green-700"}`}>{issueCount}</dd>
                        </div>
                      </dl>
                    </article>
                  );
                })
              )}
            </div>
          </div>
        </section>
      </div>

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 px-4">
          <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-sm" role="dialog" aria-modal="true">
            <h3 className="text-lg font-semibold text-slate-950">Delete dataset?</h3>
            <p className="mt-2 text-sm text-slate-600">
              You are about to delete <span className="font-medium text-slate-900">{deleteTarget.original_filename}</span>. This action cannot be undone.
            </p>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                type="button"
                onClick={closeDeleteModal}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                className="rounded-xl border border-red-200 bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting..." : "Delete dataset"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
