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
  const [isDragging, setIsDragging] = useState(false);

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

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }
  function handleDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false);
  }
  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0] ?? null;
    if (!file) return;
    const tok = token ?? getStoredToken();
    if (!tok) { toast.warning("You need to be logged in to upload."); return; }
    const isImage = /\.(png|jpe?g)$/i.test(file.name);
    setUploadingMessage(isImage ? "Extracting table from image…" : "Uploading…");
    setUploading(true);
    try {
      await uploadDataset(file, isImage ? "Uploaded via OCR" : "Dashboard upload", tok);
      await refreshDatasets(tok);
      toast.success(isImage ? "Image table extracted and saved." : "Dataset uploaded successfully.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

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
  const issuesBarData = [
    { name: "Missing Values", count: totalIssues.missing, fill: CHART_COLORS.missing },
    { name: "Duplicates", count: totalIssues.duplicate, fill: CHART_COLORS.duplicate },
    { name: "Invalid Values", count: totalIssues.invalid, fill: CHART_COLORS.invalid },
  ].filter((d) => d.count > 0);

  const recentDataset = byLatest[0] ?? null;

  const needsAttentionDatasets = [...datasets]
    .filter((d) => getHealthScore(d).label !== "Good")
    .sort((a, b) => getHealthScore(a).score - getHealthScore(b).score)
    .slice(0, 3);

  const ringRadius = 36;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringDashOffset = datasets.length > 0 ? ringCircumference - (avgScore / 100) * ringCircumference : ringCircumference;
  const ringColor = avgScore >= 80 ? "#22c55e" : avgScore >= 50 ? "#f59e0b" : "#ef4444";
  const currentPhase = datasets.length === 0 ? 1 : needsAttentionDatasets.length > 0 ? 3 : 4;

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
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-indigo-500">Smartalyze</p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">
              {username ? `Welcome back, ${username}` : "Your Datasets"}
            </h1>
            <p className="text-sm text-slate-500">
              {datasets.length > 0
                ? `Data quality portfolio — ${datasets.length} dataset${datasets.length !== 1 ? "s" : ""}`
                : "Get started by uploading your first dataset"}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Accepts CSV, Excel, JSON — or a{" "}
              <span className="font-medium text-indigo-500">PNG/JPG</span> for OCR table extraction.
            </p>
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

        {/* Workflow Guide Strip — always shown */}
        <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">How it works</p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {(
              [
                { num: 1, title: "Upload", desc: "Add a CSV, Excel, JSON, or a photo of a data table (PNG/JPG)", phase: 1 },
                { num: 2, title: "Detect Issues", desc: "Scan for missing values, duplicates, and data quality problems", phase: 2 },
                { num: 3, title: "Clean Data", desc: "Fix issues, standardize formats, and fill in missing values", phase: 3 },
                { num: 4, title: "Explore & Export", desc: "Visualize insights and download your clean, analysis-ready data", phase: 4 },
              ] as const
            ).map(({ num, title, desc, phase }) => {
              const isActive = phase === currentPhase;
              return (
                <div
                  key={num}
                  className={`rounded-xl border p-4 transition-colors ${isActive ? "border-indigo-200 bg-indigo-50" : "border-slate-100 bg-slate-50"}`}
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${isActive ? "bg-indigo-600 text-white" : "bg-slate-200 text-slate-500"}`}
                    >
                      {num}
                    </span>
                    <span className={`text-sm font-semibold ${isActive ? "text-indigo-700" : "text-slate-600"}`}>{title}</span>
                    {isActive && <span className="ml-auto h-2 w-2 rounded-full bg-indigo-400" />}
                  </div>
                  <p className="text-xs leading-relaxed text-slate-500">{desc}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Stats Section */}
        {datasets.length > 0 ? (
          <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
            {/* Portfolio Health Ring */}
            <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <svg width="100" height="100" viewBox="0 0 100 100" aria-label={`Portfolio health score: ${avgScore}%`}>
                <circle cx="50" cy="50" r={ringRadius} fill="none" stroke="#f1f5f9" strokeWidth="9" />
                <circle
                  cx="50"
                  cy="50"
                  r={ringRadius}
                  fill="none"
                  stroke={ringColor}
                  strokeWidth="9"
                  strokeLinecap="round"
                  strokeDasharray={ringCircumference}
                  strokeDashoffset={ringDashOffset}
                  transform="rotate(-90 50 50)"
                />
                <text x="50" y="50" textAnchor="middle" dy="0.35em" fontSize="20" fontWeight="700" fill="#0f172a">
                  {avgScore}
                </text>
              </svg>
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Portfolio Health</p>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  avgScore >= 80 ? "bg-green-100 text-green-700" : avgScore >= 50 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                }`}
              >
                {avgScore >= 80 ? "Good" : avgScore >= 50 ? "Fair" : "Needs Work"}
              </span>
            </div>

            {/* Sub-stats grid */}
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
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
                title="Clean Datasets"
                value={String(cleanDatasets)}
                sub={`of ${datasets.length} total`}
                accent="bg-teal-500"
                bg="border-teal-100"
              />
            </div>
          </div>
        ) : null}

        {/* Action Required */}
        {needsAttentionDatasets.length > 0 && (
          <section>
            <div className="mb-3 flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
              <h2 className="text-sm font-semibold text-slate-700">Action Required</h2>
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">
                {needsAttentionDatasets.length} dataset{needsAttentionDatasets.length > 1 ? "s" : ""}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {needsAttentionDatasets.map((d) => {
                const health = getHealthScore(d);
                const issues = getIssueItems(d);
                const borderColor = health.label === "Needs Work" ? "#ef4444" : "#f59e0b";
                return (
                  <div
                    key={d.id}
                    className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                    style={{ borderLeftWidth: 4, borderLeftColor: borderColor }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="truncate text-sm font-medium text-slate-800">{d.original_filename}</span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                          health.label === "Needs Work" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {health.score}%
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {issues.missing > 0 && <span>{issues.missing.toLocaleString()} missing cells</span>}
                      {issues.missing > 0 && issues.duplicate > 0 && <span> · </span>}
                      {issues.duplicate > 0 && <span>{issues.duplicate.toLocaleString()} duplicates</span>}
                      {issues.missing === 0 && issues.duplicate === 0 && <span>Review data quality</span>}
                    </p>
                    <Link
                      href={`/dataset/${d.id}?tab=prepare`}
                      className="mt-1 self-start rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-indigo-500"
                    >
                      Fix Now →
                    </Link>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Charts Row */}
        {datasets.length > 0 ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Data Quality Breakdown</h2>
              <p className="text-xs text-slate-500">Distribution of health scores across all datasets</p>
              {qualityPieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={qualityPieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={65}
                      outerRadius={95}
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
                <div className="flex h-64 items-center justify-center text-sm text-slate-400">
                  Upload datasets to see quality breakdown
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Top Issues</h2>
              <p className="text-xs text-slate-500">Cumulative counts across all datasets</p>
              {issuesBarData.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={issuesBarData} layout="vertical" margin={{ top: 16, right: 48, left: 8, bottom: 16 }}>
                    <XAxis type="number" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(value) => [Number(value ?? 0).toLocaleString(), "Count"]} cursor={{ fill: "#f8fafc" }} />
                    <Bar dataKey="count" radius={[0, 6, 6, 0]} label={{ position: "right", fontSize: 11, fill: "#64748b" }}>
                      {issuesBarData.map((entry, index) => (
                        <Cell key={`bar-${index}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-64 items-center justify-center flex-col gap-2">
                  <span className="text-2xl">✓</span>
                  <p className="text-sm font-medium text-emerald-600">No issues detected</p>
                  <p className="text-xs text-slate-400">Your data looks clean across all datasets.</p>
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
            <div
              className={`mt-5 flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed py-14 transition-colors ${
                isDragging ? "border-indigo-400 bg-indigo-50" : "border-slate-200 bg-slate-50/60"
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={(e) => { void handleDrop(e); }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="52" height="52" viewBox="0 0 24 24" fill="none"
                stroke={isDragging ? "#6366f1" : "#94a3b8"} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"
                aria-hidden="true">
                <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
                <path d="M12 12v9" />
                <path d="m16 16-4-4-4 4" />
              </svg>
              <div className="text-center">
                <p className={`text-lg font-semibold ${isDragging ? "text-indigo-600" : "text-slate-500"}`}>
                  {uploading ? uploadingMessage : "Drag & Drop files here"}
                </p>
                {!uploading && (
                  <p className="mt-1 text-sm text-slate-400">CSV, Excel, JSON — or a PNG/JPG for OCR table extraction</p>
                )}
              </div>
              {uploading ? (
                <div className="flex items-center gap-2 text-sm text-indigo-600">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                  </svg>
                  {uploadingMessage}
                </div>
              ) : (
                <>
                  <p className="text-sm text-slate-400">or</p>
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      className="rounded-xl border-2 border-indigo-400 bg-white px-6 py-2.5 text-sm font-bold text-indigo-500 transition hover:bg-indigo-50"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Browse Files
                    </button>
                    <button
                      type="button"
                      className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
                      onClick={handleLoadSample}
                      disabled={loadingSample}
                    >
                      {loadingSample ? "Loading…" : "Try sample data"}
                    </button>
                  </div>
                </>
              )}
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
                    const rowBorderColor = health.score >= 80 ? "#22c55e" : health.score >= 50 ? "#f59e0b" : "#ef4444";
                    return (
                      <tr key={dataset.id} className="transition hover:bg-slate-50/60">
                        <td
                          className="py-3 pl-0 pr-4"
                          style={{ borderLeft: `4px solid ${rowBorderColor}`, paddingLeft: 12 }}
                        >
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
                        <td className="px-4 py-3 min-w-32.5">
                          <div className="flex flex-col gap-1" title={`Score: ${health.score}. Good ≥80, Fair ≥50, Needs Work <50`}>
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-xs font-semibold text-slate-700">{health.score}%</span>
                              <span className={`text-xs font-medium ${health.score >= 80 ? "text-green-600" : health.score >= 50 ? "text-amber-600" : "text-red-600"}`}>
                                {health.label}
                              </span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${health.score}%`, backgroundColor: rowBorderColor }}
                              />
                            </div>
                          </div>
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
