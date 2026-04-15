"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import {
  createDatasetVersion,
  DatasetWorkspace,
  getDatasetWorkspace,
} from "@/lib/api";
import { clearStoredToken, getStoredToken } from "@/lib/auth";

type WorkspaceTab = "overview" | "cleaning" | "analysis" | "aggregation" | "prediction";

export default function DatasetWorkspacePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const datasetId = Number(params.id);
  const [workspace, setWorkspace] = useState<DatasetWorkspace | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("overview");
  const [token, setToken] = useState<string | null>(null);
  const [operationType, setOperationType] = useState("cleaned");
  const [replaceCurrent, setReplaceCurrent] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const storedToken = getStoredToken();
    if (!storedToken) {
      router.replace("/login");
      return;
    }
    setToken(storedToken);

    if (!Number.isFinite(datasetId)) {
      router.replace("/dashboard");
      return;
    }

    getDatasetWorkspace(datasetId, storedToken)
      .then(setWorkspace)
      .catch(() => {
        clearStoredToken();
        router.replace("/login");
      })
      .finally(() => setLoading(false));
  }, [datasetId, router]);

  async function handleSaveVersion() {
    if (!workspace || !token) {
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const version = await createDatasetVersion(
        workspace.dataset.id,
        { operation_type: operationType, replace_current: replaceCurrent },
        token,
      );
      setWorkspace({
        ...workspace,
        versions: [...workspace.versions, version].sort((left, right) => left.version_number - right.version_number),
      });
      setMessage("Version saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save version.");
    } finally {
      setSaving(false);
    }
  }

  function renderPreviewTable() {
    const previewRows = workspace?.dataset.preview_json ?? [];
    if (previewRows.length === 0) {
      return <p className="text-sm text-slate-600">No preview available.</p>;
    }

    const columns = Object.keys(previewRows[0] ?? {});
    return (
      <div className="overflow-x-auto rounded-2xl border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              {columns.map((column) => (
                <th key={column} className="px-4 py-3 text-left font-medium text-slate-600">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {previewRows.map((row, index) => (
              <tr key={index}>
                {columns.map((column) => (
                  <td key={column} className="px-4 py-3 text-slate-800">
                    {String((row as Record<string, unknown>)[column] ?? "-")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function renderTabContent() {
    if (!workspace) {
      return null;
    }

    if (activeTab === "overview") {
      return (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-sm text-slate-500">Rows</p>
              <p className="mt-1 text-2xl font-semibold">{workspace.dataset.row_count ?? "-"}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-sm text-slate-500">Columns</p>
              <p className="mt-1 text-2xl font-semibold">{workspace.dataset.column_count ?? "-"}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-sm text-slate-500">Missing cells</p>
              <p className="mt-1 text-2xl font-semibold">{String(workspace.dataset.summary_json?.missing_cells ?? "-")}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-sm text-slate-500">Duplicates</p>
              <p className="mt-1 text-2xl font-semibold">{String(workspace.dataset.summary_json?.duplicate_rows ?? "-")}</p>
            </div>
          </div>
          {renderPreviewTable()}
        </div>
      );
    }

    const descriptions: Record<Exclude<WorkspaceTab, "overview">, string> = {
      cleaning: "Detect missing values, duplicates, and type issues here. The result can be saved as a new version.",
      analysis: "Show summary statistics, distributions, and data quality insights here.",
      aggregation: "Group by categorical columns and compute sums, averages, counts, and min/max values.",
      prediction: "Use a simple linear regression flow for controlled, explainable prediction.",
    };

    return (
      <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
        {descriptions[activeTab as Exclude<WorkspaceTab, "overview">]}
      </div>
    );
  }

  if (loading) {
    return <main className="min-h-screen bg-slate-100 px-4 py-10 text-slate-900">Loading workspace...</main>;
  }

  if (!workspace) {
    return null;
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Dataset workspace</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">{workspace.dataset.original_filename}</h1>
              <p className="text-sm text-slate-600">Versioned workspace for previewing, cleaning, analyzing, and exporting data.</p>
            </div>
            <Link className="text-sm font-medium text-slate-900 underline" href="/dashboard">
              Back to dashboard
            </Link>
          </div>
        </header>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-4">
              {(["overview", "cleaning", "analysis", "aggregation", "prediction"] as WorkspaceTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    activeTab === tab ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            <div className="mt-6">{renderTabContent()}</div>
          </div>

          <aside className="space-y-6">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Save result</h2>
              <p className="mt-1 text-sm text-slate-600">Use this after an action to create a new version of the current dataset.</p>
              <label className="mt-4 block">
                <span className="mb-2 block text-sm font-medium">Operation type</span>
                <input
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-slate-900"
                  value={operationType}
                  onChange={(event) => setOperationType(event.target.value)}
                />
              </label>
              <label className="mt-4 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={replaceCurrent}
                  onChange={(event) => setReplaceCurrent(event.target.checked)}
                />
                Replace current dataset preview with this result
              </label>
              <button
                type="button"
                className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                disabled={saving}
                onClick={handleSaveVersion}
              >
                {saving ? "Saving..." : "Save as new version"}
              </button>
              {message ? <p className="mt-3 text-sm text-slate-600">{message}</p> : null}
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Versions</h2>
              <div className="mt-4 space-y-3">
                {workspace.versions.map((version) => (
                  <div key={version.id} className="rounded-2xl border border-slate-200 p-4 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">Version {version.version_number}</span>
                      <span className="text-xs uppercase tracking-[0.2em] text-slate-500">{version.operation_type}</span>
                    </div>
                    <p className="mt-2 text-slate-600">{new Date(version.created_at).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Next actions</h2>
              <div className="mt-4 space-y-3 text-sm text-slate-600">
                <p>1. Save the result as a new dataset.</p>
                <p>2. Save the result as a new version.</p>
                <p>3. Replace the current dataset.</p>
                <p>4. Export the result as CSV or insights.</p>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
