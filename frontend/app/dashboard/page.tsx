"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Dataset, deleteDataset, getCurrentUser, listDatasets, uploadDataset } from "@/lib/api";
import { clearStoredToken, getStoredToken } from "@/lib/auth";

type DatasetSortKey = "recent" | "name" | "size";

const CHART_COLORS = {
  good: "#22c55e",
  fair: "#f59e0b",
  needsWork: "#ef4444",
  missing: "#f59e0b",
  duplicate: "#ef4444",
  invalid: "#f97316",
};

function getNumericSummaryValue(summary: Record<string, unknown> | null | undefined, keys: string[]): number {
  for (const key of keys) {
    const value = summary?.[key];
    const numericValue = typeof value === "number" ? value : Number(value ?? 0);
    if (Number.isFinite(numericValue) && numericValue > 0) return numericValue;
  }
  return 0;
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

function getIssueItems(dataset: Dataset) {
  const summary = dataset.summary_json ?? {};
  return {
    missing: getNumericSummaryValue(summary, ["missing_cells", "missing_values"]),
    duplicate: getNumericSummaryValue(summary, ["duplicate_rows", "duplicates"]),
    invalid: getNumericSummaryValue(summary, ["invalid_values", "invalid_rows", "invalid_data_types", "type_issues"]),
  };
}

function formatRelativeDate(value: string): string {
  const date = new Date(value);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

type StatCardProps = { title: string; value: string; sub: string; accent: string; bg: string };

function StatCard({ title, value, sub, accent, bg }: StatCardProps) {
  return (
    <article className={`rounded-2xl border bg-white p-5 shadow-sm ${bg}`}>
      <div className={`mb-3 h-1 w-10 rounded-full ${accent}`} />
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{title}</p>
      <p className="mt-1 text-3xl font-bold tracking-tight text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{sub}</p>
    </article>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [username, setUsername] = useState<string | null>(null);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadingMessage, setUploadingMessage] = useState("Uploading…");
  const [token, setToken] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Dataset | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<DatasetSortKey>("recent");

  useEffect(() => {
    const storedToken = getStoredToken();
    if (!storedToken) { router.replace("/login"); return; }
    setToken(storedToken);
    Promise.all([getCurrentUser(storedToken), listDatasets(storedToken)])
      .then(([user, datasetList]) => { setUsername(user.username); setDatasets(datasetList); })
      .catch(() => { clearStoredToken(); router.replace("/login"); })
      .finally(() => setLoading(false));
  }, [router]);

  async function refreshDatasets(t?: string) {
    const tok = t ?? token;
    if (!tok) return;
    const list = await listDatasets(tok);
    setDatasets(list);
  }

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;
    const tok = token ?? getStoredToken();
    if (!tok) { toast.warning("You need to be logged in to upload."); return; }
    const isImage = /\.(png|jpe?g)$/i.test(file.name);
    setUploadingMessage(isImage ? "Extracting table from image…" : "Uploading…");
    setUploading(true);
    try {
      await uploadDataset(file, isImage ? "Uploaded via OCR" : "Dashboard upload", tok);
      event.target.value = "";
      await refreshDatasets(tok);
      toast.success(isImage ? "Image table extracted and saved as dataset." : "Dataset uploaded successfully.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function handleLoadSample() {
    const tok = token ?? getStoredToken();
    if (!tok) { toast.warning("You need to be logged in."); return; }
    setLoadingSample(true);
    try {
      const res = await fetch("/sample-dataset.csv");
      const blob = await res.blob();
      const file = new File([blob], "sample-dataset.csv", { type: "text/csv" });
      await uploadDataset(file, "Sample dataset with messy sales data", tok);
      await refreshDatasets(tok);
      toast.success("Sample dataset loaded successfully.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load sample.");
    } finally {
      setLoadingSample(false);
    }
  }

  async function handleConfirmDelete() {
    const tok = token ?? getStoredToken();
    if (!tok || !deleteTarget) return;
    setDeleting(true);
    try {
      await deleteDataset(deleteTarget.id, tok);
      await refreshDatasets(tok);
      toast.success(`Deleted "${deleteTarget.original_filename}".`);
      setDeleteTarget(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delete failed.");
    } finally {
      setDeleting(false);
    }
  }

  function handleLogout() { clearStoredToken(); router.replace("/login"); }

  // Derived data
  const byLatest = [...datasets].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const trimmed = searchQuery.trim().toLowerCase();
  const filtered = trimmed
    ? byLatest.filter((d) => (d.original_filename ?? "").toLowerCase().includes(trimmed) || (d.description ?? "").toLowerCase().includes(trimmed))
    : byLatest;
  const sorted = (() => {
    const copy = [...filtered];
    if (sortKey === "name") return copy.sort((a, b) => (a.original_filename ?? "").localeCompare(b.original_filename ?? ""));
    if (sortKey === "size") return copy.sort((a, b) => Number(b.row_count ?? 0) - Number(a.row_count ?? 0));
    return copy;
  })();

  const totalRows = datasets.reduce((s, d) => s + Number(d.row_count ?? 0), 0);
  const totalColumns = datasets.reduce((s, d) => s + Number(d.column_count ?? 0), 0);
  const healthCounts = datasets.reduce((acc, d) => {
    const h = getHealthScore(d).label;
    acc[h] = (acc[h] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const cleanDatasets = healthCounts["Good"] ?? 0;
  const avgScore = datasets.length > 0
    ? Math.round(datasets.reduce((s, d) => s + getHealthScore(d).score, 0) / datasets.length)
    : 0;

  const qualityPieData = [
    { name: "Good", value: healthCounts["Good"] ?? 0, fill: CHART_COLORS.good },
    { name: "Fair", value: healthCounts["Fair"] ?? 0, fill: CHART_COLORS.fair },
    { name: "Needs Work", value: healthCounts["Needs Work"] ?? 0, fill: CHART_COLORS.needsWork },
  ].filter((d) => d.value > 0);

  const totalIssues = datasets.reduce(
    (acc, d) => {
      const issues = getIssueItems(d);
      acc.missing += issues.missing;
      acc.duplicate += issues.duplicate;
      acc.invalid += issues.invalid;
      return acc;
    },
    { missing: 0, duplicate: 0, invalid: 0 },
  );
  const totalIssueCount = totalIssues.missing + totalIssues.duplicate + totalIssues.invalid;
  const issuesBarData = [
    { name: "Missing Values", count: totalIssues.missing, fill: CHART_COLORS.missing },
    { name: "Duplicates", count: totalIssues.duplicate, fill: CHART_COLORS.duplicate },
    { name: "Invalid Values", count: totalIssues.invalid, fill: CHART_COLORS.invalid },
  ].filter((d) => d.count > 0);

  const fileTypeData = [
    { name: "CSV", count: datasets.filter((d) => d.file_format === "csv").length, fill: "#6366f1" },
    { name: "Excel", count: datasets.filter((d) => d.file_format === "excel").length, fill: "#22c55e" },
    { name: "JSON", count: datasets.filter((d) => d.file_format === "json").length, fill: "#f59e0b" },
    { name: "Image", count: datasets.filter((d) => d.file_format === "image").length, fill: "#a78bfa" },
  ].filter((d) => d.count > 0);

  const recentDataset = byLatest[0] ?? null;

  const needsAttentionDatasets = [...datasets]
    .filter((d) => getHealthScore(d).label !== "Good")
    .sort((a, b) => getHealthScore(a).score - getHealthScore(b).score)
    .slice(0, 3);

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 px-6 py-10">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-2xl bg-slate-200" />
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-8 text-slate-900">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">

        {/* Page Header */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-indigo-500">Smartalyze</p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">
              {username ? `Welcome back, ${username}` : "Your Datasets"}
            </h1>
            <p className="text-sm text-slate-500">Data quality portfolio — {datasets.length} dataset{datasets.length !== 1 ? "s" : ""} total.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileInputRef} className="hidden" type="file" accept=".csv,.xlsx,.xls,.json,.png,.jpg,.jpeg" onChange={handleUpload} />
            <button
              type="button"
              className="rounded-xl border border-indigo-200 bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-60"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? uploadingMessage : "Upload Dataset"}
            </button>
            <button
              type="button"
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
              onClick={handleLoadSample}
              disabled={loadingSample}
            >
              {loadingSample ? "Loading…" : "Load Sample"}
            </button>
            {recentDataset ? (
              <Link
                href={`/dataset/${recentDataset.id}`}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Open Recent
              </Link>
            ) : null}
            <button
              type="button"
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-50"
              onClick={handleLogout}
            >
              Logout
            </button>
          </div>
        </header>

        {/* Stat Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            title="Total Datasets"
            value={String(datasets.length)}
            sub="All uploads"
            accent="bg-indigo-500"
            bg="border-indigo-100"
          />
          <StatCard
            title="Total Rows"
            value={totalRows > 0 ? totalRows.toLocaleString() : "0"}
            sub="Across all datasets"
            accent="bg-sky-500"
            bg="border-sky-100"
          />
          <StatCard
            title="Total Columns"
            value={totalColumns > 0 ? totalColumns.toLocaleString() : "0"}
            sub="Across all datasets"
            accent="bg-purple-500"
            bg="border-purple-100"
          />
          <StatCard
            title="Avg Health Score"
            value={datasets.length > 0 ? `${avgScore}%` : "—"}
            sub="Quality index"
            accent="bg-emerald-500"
            bg="border-emerald-100"
          />
          <StatCard
            title="Clean Datasets"
            value={String(cleanDatasets)}
            sub={`of ${datasets.length} total`}
            accent="bg-teal-500"
            bg="border-teal-100"
          />
          <StatCard
            title="Total Issues"
            value={totalIssueCount > 0 ? totalIssueCount.toLocaleString() : "0"}
            sub="Missing · dupes · invalid"
            accent="bg-red-500"
            bg="border-red-100"
          />
        </div>

        {/* Needs Attention */}
        {needsAttentionDatasets.length > 0 && (
          <section className="mb-2">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Needs Attention</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {needsAttentionDatasets.map((d) => {
                const health = getHealthScore(d);
                const issues = getIssueItems(d);
                return (
                  <div key={d.id} className="flex flex-col gap-1.5 rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-slate-800">{d.original_filename}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${health.label === "Needs Work" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                        {health.label}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {issues.missing > 0 && <>{issues.missing.toLocaleString()} missing cells</>}
                      {issues.missing > 0 && issues.duplicate > 0 && <> · </>}
                      {issues.duplicate > 0 && <>{issues.duplicate.toLocaleString()} duplicates</>}
                      {issues.missing === 0 && issues.duplicate === 0 && "Review data quality"}
                    </p>
                    <Link
                      href={`/dataset/${d.id}?tab=prepare`}
                      className="mt-auto self-end text-xs font-medium text-indigo-600 hover:underline"
                    >
                      Fix now →
                    </Link>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Charts Row */}
        {datasets.length > 0 ? (
          <div className="grid gap-6 lg:grid-cols-[2fr_1fr_1fr]">
            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Data Quality Breakdown</h2>
              <p className="text-xs text-slate-500">Distribution of health scores across all datasets</p>
              {qualityPieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={qualityPieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={3}
                      dataKey="value"
                      label={({ name, value }) => `${name}: ${value}`}
                      labelLine={false}
                    >
                      {qualityPieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => [`${value} dataset${Number(value) !== 1 ? "s" : ""}`, ""]} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-55 items-center justify-center text-sm text-slate-400">
                  Upload datasets to see quality breakdown
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Top Issues</h2>
              <p className="text-xs text-slate-500">Cumulative counts across all datasets</p>
              {issuesBarData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={issuesBarData} layout="vertical" margin={{ top: 8, right: 32, left: 8, bottom: 0 }}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(value) => [value, "Count"]} cursor={{ fill: "#f1f5f9" }} />
                    <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                      {issuesBarData.map((entry, index) => (
                        <Cell key={`bar-${index}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-55 items-center justify-center text-sm text-slate-400">
                  No issues detected — data looks clean.
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">File Types</h2>
              <p className="text-xs text-slate-500">Breakdown by format</p>
              {fileTypeData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={fileTypeData} layout="vertical" margin={{ top: 8, right: 32, left: 8, bottom: 0 }}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" width={44} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(value) => [value, "Datasets"]} cursor={{ fill: "#f1f5f9" }} />
                    <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                      {fileTypeData.map((entry, index) => (
                        <Cell key={`ft-${index}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-55 items-center justify-center text-sm text-slate-400">
                  No data yet.
                </div>
              )}
            </div>
          </div>
        ) : null}

        {/* Dataset List */}
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Datasets</h2>
              {sorted.length !== datasets.length && trimmed ? (
                <p className="text-xs text-slate-500">{sorted.length} of {datasets.length} match &ldquo;{searchQuery}&rdquo;</p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search datasets…"
                className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-900 outline-none transition focus:border-indigo-500 w-52"
              />
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as DatasetSortKey)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none transition focus:border-indigo-500"
              >
                <option value="recent">Most recent</option>
                <option value="name">Name (A→Z)</option>
                <option value="size">Most rows</option>
              </select>
            </div>
          </div>

          {datasets.length === 0 ? (
            <div className="mt-5">
              <p className="mb-4 text-sm font-medium text-slate-700">Get started in 4 steps</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {([
                  { step: "1", title: "Upload", desc: "Add a CSV, Excel, JSON, or a photo of a data table (PNG/JPG)" },
                  { step: "2", title: "Clean", desc: "Remove duplicates, fill missing values, standardise types" },
                  { step: "3", title: "Explore", desc: "Group, trend, and visualise your data with one click" },
                  { step: "4", title: "Export", desc: "Download your cleaned data or analysis results" },
                ] as const).map(({ step, title, desc }) => (
                  <div key={step} className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-5">
                    <p className="text-xs font-bold text-indigo-400">Step {step}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{title}</p>
                    <p className="mt-1 text-xs text-slate-500 leading-relaxed">{desc}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Upload your first dataset
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                  onClick={handleLoadSample}
                  disabled={loadingSample}
                >
                  {loadingSample ? "Loading…" : "Try sample data"}
                </button>
              </div>
            </div>
          ) : sorted.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
              No datasets match your search.
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-xl border border-slate-100">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Name</th>
                    <th className="px-4 py-3 text-left font-medium">Rows</th>
                    <th className="px-4 py-3 text-left font-medium">Cols</th>
                    <th className="px-4 py-3 text-left font-medium">Health</th>
                    <th className="px-4 py-3 text-left font-medium">Issues</th>
                    <th className="px-4 py-3 text-left font-medium">Last modified</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 bg-white">
                  {sorted.map((dataset) => {
                    const health = getHealthScore(dataset);
                    const issues = getIssueItems(dataset);
                    const hasIssues = issues.missing > 0 || issues.duplicate > 0 || issues.invalid > 0;
                    const issueParts: string[] = [];
                    if (issues.missing > 0) issueParts.push(`${issues.missing} missing`);
                    if (issues.duplicate > 0) issueParts.push(`${issues.duplicate} dup${issues.duplicate !== 1 ? "s" : ""}`);
                    if (issues.invalid > 0) issueParts.push(`${issues.invalid} invalid`);
                    return (
                      <tr key={dataset.id} className="transition hover:bg-slate-50/60">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <p className="max-w-44 truncate font-medium text-slate-900">{dataset.original_filename}</p>
                            {dataset.file_format === "image" && (
                              <span className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium bg-violet-100 text-violet-700">OCR</span>
                            )}
                          </div>
                          {dataset.description ? (
                            <p className="mt-0.5 max-w-50 truncate text-xs text-slate-400">{dataset.description}</p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{dataset.row_count?.toLocaleString() ?? "—"}</td>
                        <td className="px-4 py-3 text-slate-600">{dataset.column_count ?? "—"}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-medium cursor-help ${health.classes}`}
                            title={`Score: ${health.score}. Good ≥80, Fair ≥50, Needs Work <50`}
                          >
                            {health.label} · {health.score}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {hasIssues ? (
                            <span className="text-xs font-medium text-amber-700">{issueParts.join(" · ")}</span>
                          ) : (
                            <span className="text-xs text-emerald-600">Clean</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500" title={formatDate(dataset.created_at)}>
                          {formatRelativeDate(dataset.created_at)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-3">
                            <Link
                              href={`/dataset/${dataset.id}`}
                              className="text-xs font-medium text-indigo-600 transition hover:text-indigo-800"
                            >
                              Open
                            </Link>
                            <button
                              type="button"
                              className="text-xs font-medium text-red-500 transition hover:text-red-700"
                              onClick={() => setDeleteTarget(dataset)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl" role="dialog" aria-modal="true">
            <h3 className="text-base font-semibold text-slate-900">Delete dataset?</h3>
            <p className="mt-2 text-sm text-slate-600">
              You are about to permanently delete{" "}
              <span className="font-medium text-slate-900">{deleteTarget.original_filename}</span>.
              This cannot be undone.
            </p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                type="button"
                onClick={() => { if (!deleting) setDeleteTarget(null); }}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500 disabled:opacity-60"
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
