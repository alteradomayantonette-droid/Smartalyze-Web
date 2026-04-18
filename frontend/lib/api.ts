export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export type AuthUser = {
  id: number;
  username: string;
  created_at: string;
};

export type AuthResponse = {
  message: string;
  token: string;
  user: AuthUser;
};

export type Dataset = {
  id: number;
  owner_user_id: number;
  original_filename: string;
  stored_filename: string;
  file_path: string;
  mime_type: string | null;
  file_format: string;
  description: string | null;
  size_bytes: number;
  row_count: number | null;
  column_count: number | null;
  columns_json: Array<Record<string, unknown>> | null;
  preview_json: Array<Record<string, unknown>> | null;
  summary_json: Record<string, unknown> | null;
  created_at: string;
};

export type DatasetVersion = {
  id: number;
  dataset_id: number;
  version_number: number;
  operation_type: string;
  artifact_path: string;
  artifact_filename: string;
  row_count: number | null;
  column_count: number | null;
  preview_json: Array<Record<string, unknown>> | null;
  columns_json: Array<Record<string, unknown>> | null;
  summary_json: Record<string, unknown> | null;
  created_at: string;
};

export type DatasetWorkspace = {
  dataset: Dataset;
  warnings: Array<{ scope: string; severity: string; message: string }>;
  suggestions: Array<{ scope: string; message: string }>;
};

export type CleaningIssue = {
  kind: string;
  severity: "info" | "warning" | "error";
  column: string | null;
  message: string;
  suggestion: string | null;
  details: Record<string, unknown> | null;
};

export type CleaningOperation = {
  operation_type: "fill_mean" | "fill_median" | "fill_mode" | "drop_rows" | "remove_all_duplicates" | "convert_column_type" | "trim_whitespace" | "lowercase_column";
  columns?: string[];
  column?: string | null;
  target_type?: "numeric" | "string" | "datetime" | "categorical" | "boolean" | null;
  drop_all_missing?: boolean;
  errors?: "raise" | "coerce" | "ignore";
};

export type CleanDetectResponse = {
  dataset_id: number;
  dataset_version_id: number;
  missing_values: Record<string, number>;
  duplicates: number;
  column_types: Record<string, string>;
  issues: CleaningIssue[];
};

export type CleanApplyResponse = CleanDetectResponse & {
  source_version_id: number;
  operations_applied: CleaningOperation[];
  preview: Array<Record<string, unknown>>;
  summary: Record<string, unknown>;
  data_snapshot: Record<string, unknown>;
};

export type SaveResultRequest = {
  replace_current: boolean;
  dataset_name?: string | null;
  description?: string | null;
  data_snapshot?: Record<string, unknown> | null;
};

export type SaveResultResponse = {
  message: string;
  dataset: Dataset;
};

const REQUEST_TIMEOUT_MS = 15000;

async function request<T>(path: string, options?: RequestInit, token?: string): Promise<T> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(options?.headers ?? {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new Error(errorBody?.detail ?? "Request failed.");
    }

    return response.json() as Promise<T>;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request timed out. Please try again.");
    }

    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

export function registerUser(username: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>("/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

export function loginUser(username: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

export function getCurrentUser(token: string): Promise<AuthUser> {
  return request<AuthUser>("/me", {}, token);
}

export function listDatasets(token: string): Promise<Dataset[]> {
  return request<Dataset[]>("/datasets", {}, token);
}

export function getDatasetWorkspace(datasetId: number, token: string): Promise<DatasetWorkspace> {
  return request<DatasetWorkspace>(`/dataset/${datasetId}`, {}, token);
}

export function createDatasetVersion(
  datasetId: number,
  payload: { operation_type: string; replace_current?: boolean; data_snapshot?: Record<string, unknown> | null },
  token: string,
): Promise<DatasetVersion> {
  return request<DatasetVersion>(
    `/dataset/${datasetId}/versions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    token,
  );
}

export function detectCleaningIssues(
  datasetId: number,
  token: string,
  datasetVersionId?: number | null,
): Promise<CleanDetectResponse> {
  return request<CleanDetectResponse>(
    "/clean/detect",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataset_id: datasetId, dataset_version_id: datasetVersionId ?? null }),
    },
    token,
  );
}

export function applyCleaningOperations(
  datasetId: number,
  cleaningOperations: CleaningOperation[],
  token: string,
  datasetVersionId?: number | null,
): Promise<CleanApplyResponse> {
  return request<CleanApplyResponse>(
    "/clean/apply",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataset_id: datasetId, dataset_version_id: datasetVersionId ?? null, cleaning_operations: cleaningOperations }),
    },
    token,
  );
}

export function saveDatasetResult(datasetId: number, payload: SaveResultRequest, token: string): Promise<SaveResultResponse> {
  return request<SaveResultResponse>(
    `/dataset/${datasetId}/result`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    token,
  );
}

export async function uploadDataset(file: File, description: string, token?: string): Promise<{ message: string; dataset: Dataset }> {
  const formData = new FormData();
  formData.append("file", file);
  if (description.trim()) {
    formData.append("description", description.trim());
  }

  const response = await fetch(`${API_BASE_URL}/upload`, {
    method: "POST",
    body: formData,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(errorBody?.detail ?? "Upload failed.");
  }

  return response.json() as Promise<{ message: string; dataset: Dataset }>;
}
