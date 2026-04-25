# Smartalyze — Copilot Handoff (Capstone + System)

Date: 2026-04-26

## Why this file exists

Copilot Chat history may not sync across devices reliably. This note is the source of truth for:

- What Smartalyze currently implements in code (demo-able now)
- What the CAPSTONE document/diagrams must claim (implemented vs planned)
- What we already fixed/added in the repo
- What to build next (future features)

This was written to support a May 20 presentation where **diagrams and descriptions must match the working system**.

---

## Project snapshot

- Backend: FastAPI + async SQLAlchemy + PostgreSQL (JSONB snapshots)
- Frontend: Next.js (App Router), React, TypeScript, Tailwind
- Overall architecture: web client-server; dataset content stored as versioned JSON snapshots.

Repo layout:

- backend/
- frontend/

---

## Current data model (what actually exists)

Smartalyze does NOT store row-level data in a Data_Record table. Instead, it stores datasets as immutable-ish snapshots.

### Tables / ORM models (implemented)

- users, auth_sessions
  - backend/app/models/auth.py
- datasets
  - backend/app/models/dataset.py
- dataset_versions (JSON snapshots)
  - backend/app/models/dataset_version.py
- dataset_actions (audit/event log)
  - backend/app/models/dataset_action.py

### Key design points

- Dataset content is stored in dataset_versions.data_snapshot (PostgreSQL JSONB).
- datasets.current_version_id points at the “current” snapshot.
- Deleting a dataset cascades to versions/actions.

---

## Implemented backend API surface (demo-able)

Auth:

- POST /register
- POST /login
- GET /me

Datasets:

- POST /upload
- GET /datasets
- GET /dataset/{dataset_id} (workspace view: dataset + computed guidance)
- POST /dataset/{dataset_id}/result (save flow: replace current OR save as new dataset)
- POST /dataset/{dataset_id}/export (download CSV/XLSX/JSON; supports exporting unsaved result snapshot)
- DELETE /dataset/{dataset_id}

Cleaning:

- POST /clean/detect
- POST /clean/apply

Relevant route files:

- backend/app/routes/auth.py
- backend/app/routes/datasets.py
- backend/app/routes/cleaning.py

---

## Implemented user workflow (today)

This is the workflow your documentation/DFDs should reflect.

1. Register/Login

- User registers or logs in.
- Backend creates a server-side session and returns a Bearer token.

2. Upload dataset

- User uploads CSV/XLSX/JSON.
- Backend validates/parses and creates:
  - Dataset row
  - Initial DatasetVersion snapshot
  - Optionally logs DatasetAction

3. Dashboard (list datasets)

- User sees list of datasets.
- Can open dataset workspace.

4. Dataset workspace (view)

- User views dataset preview/summary and guidance.
- Guidance is computed from snapshot summary fields.

5. Cleaning detect/apply

- Detect step returns missing/duplicates/inferred types/issues.
- Apply step returns cleaned preview/summary and a cleaned snapshot.
- IMPORTANT: apply does not automatically persist; the UI holds unsaved result state.

6. Save result

- User chooses either:
  - Replace current dataset: create new DatasetVersion and set it current.
  - Save as new dataset: create a new Dataset + initial version from the snapshot.

7. Export

- User chooses export format: CSV/XLSX/JSON.
- Export can use:
  - Stored current snapshot, OR
  - Client-provided unsaved snapshot

8. Delete

- User deletes a dataset.
- Backend enforces ownership and cascades dependent rows.

---

## Frontend behavior (important notes)

- The dataset workspace page holds unsaved cleaning result snapshots in UI state.
- Export is available anytime and supports exporting that unsaved snapshot.
- Token handling uses Authorization: Bearer <token>.

Key frontend files:

- frontend/lib/api.ts (API wrapper; includes exportDataset)
- frontend/app/dashboard/page.tsx (list/upload/delete + confirmation flow)
- frontend/app/dataset/[id]/page.tsx (workspace, cleaning, save result, export)
- frontend/components/Navbar.tsx (hydration-safe token read)

---

## Work completed / fixes already made (this repo state)

Features implemented:

- Dataset deletion + confirmation modal in the UI.
- Export current dataset/result anytime (CSV/XLSX/JSON).
  - Backend returns attachment bytes and sets Content-Disposition.
  - CORS exposes Content-Disposition.

Bug fixes:

- Frontend hydration mismatch fixed (Navbar delayed localStorage token read until after mount).
- Backend /dataset/{id}/result fixed: removed MultipleResultsFound crash by switching to aggregate query for next version number.
- Pandas warning noise reduced around datetime inference during cleaning/type inference.

---

## CAPSTONE alignment: the agreed rule

For the May 20 presentation:

- The CAPSTONE diagrams and “System Design/DFD/ERD/Data Dictionary” must reflect only what the system can demonstrate end-to-end now.
- Any not-yet-built capabilities (analysis/anomaly/report/visualizations) must be labeled as Planned/Future Enhancements, not shown as implemented DB tables or data stores.

Reason:

- Panels often treat ERD/DFD as literal claims about implemented storage and processes. Mismatches are a common defense failure point.

---

## CAPSTONE changes we identified (what to edit)

### ERD (image8)

Replace old entities (Data_Record, Cleaning_Log, Analysis, Insight, Report) with real tables:

- Users
- Auth Sessions
- Datasets
- Dataset Versions (snapshots)
- Dataset Actions (audit log)

Key relationships:

- Users 1..\* Datasets
- Users 1..\* AuthSessions
- Datasets 1..\* DatasetVersions
- Datasets 1..\* DatasetActions
- Datasets 0..1 current_version_id -> DatasetVersions.id

### Use Case diagram (image5)

Remove from “implemented” diagram:

- Run data analysis
- Detect anomalies
- Generate insights
- Generate report
- Export report

Keep/replace with implemented actions:

- Register, Login
- Upload dataset
- List datasets
- View dataset workspace
- Detect data quality issues
- Apply cleaning operations
- Save result (replace current / save as new)
- Export dataset/result
- Delete dataset

Include/extend suggestion:

- Apply cleaning operations <<include>> Detect data quality issues
- Save result <<extend>> Apply cleaning operations
- Export dataset/result <<extend>> View dataset workspace
- Replace current / Save as new <<extend>> Save result

### Level 0 DFD (context)

Replace “Analysis Request / Analysis Result / Generated Report” with:
Inputs:

- Credentials
- Dataset file
- Dataset operation requests (view/clean/save/export/delete)

Outputs:

- Auth status/token
- Dataset list/workspace view
- Cleaning detect/apply results
- Save result confirmation
- Exported file (CSV/XLSX/JSON)
- Validation/error notifications

### Level 1 DFD (image7)

Remove:

- Analysis DB
- Process 4.0 Data Analysis
- Process 5.0 Report Generation

Replace with implemented decomposition:
1.0 User Authentication
2.0 Dataset Workspace / Dataset Management
3.0 Data Cleaning (Detect + Apply)
4.0 Export Dataset/Result
5.0 Save Result

Data stores:

- D1 User Database (users + auth_sessions)
- D2 Dataset Database (datasets + dataset_versions + dataset_actions)

Also remove the old paragraph that says:

- “Data Store: D1 — Uploaded Datasets (Temporary storage...)”
  Because storage is persistent DB + client-side unsaved snapshots.

---

## CAPSTONE replacement text (paste-ready)

### Level 1 DFD description (paste-ready)

The Level 1 Data Flow Diagram (DFD) presents a detailed decomposition of the Smartalyze system, expanding the single process shown in the Level 0 diagram into multiple interconnected sub-processes. This representation follows the Gane and Sarson method and illustrates how data moves through the system—from user input to system outputs—while interacting with the system’s data stores.

The diagram highlights the interaction between the user, the Smartalyze sub‑processes, and the primary data stores: the User Database (accounts and sessions) and the Dataset Database (datasets, snapshot versions, and action logs). Smartalyze stores dataset contents as versioned JSON snapshots and returns cleaning results and export files based on the current or user-provided snapshot.

Processes:

1.0 User Authentication
This process handles user registration and login. It receives user credentials from the user and validates them against the User Database. Upon successful authentication, the system creates a session and returns an authentication token (or returns an error message if authentication fails).

2.0 Dataset Workspace / Dataset Management
This process manages dataset operations initiated by the user. It receives dataset files (CSV, Excel, JSON) for upload, validates file structure and readability, and stores the uploaded dataset in the Dataset Database. It also supports listing datasets, viewing a dataset workspace (preview/summary), and deleting datasets owned by the user.

3.0 Data Cleaning (Detect and Apply)
This process performs rule-based data cleaning on a dataset snapshot. It retrieves the selected dataset snapshot (current version by default, or a specified version when provided) from the Dataset Database, detects data quality issues (e.g., missing values, duplicates, inconsistent data types), and applies user-selected cleaning operations. The output of this process is a cleaned result snapshot and updated quality summaries returned to the user. Cleaning results are not automatically persisted until the user chooses to save them.

4.0 Export Dataset/Result
This process allows users to export the current dataset or a cleaned/processed result as a downloadable file. It receives an export request (CSV/XLSX/JSON) and uses either (a) the dataset’s current stored snapshot from the Dataset Database or (b) a user-provided result snapshot (for exporting unsaved results). The system returns an exportable file to the user.

5.0 Save Result
This process persists a cleaning/result snapshot based on user intent. The user may choose to (a) replace the current dataset by saving a new snapshot version and setting it as current, or (b) save the result as a new dataset. The system writes the new snapshot and related metadata to the Dataset Database and returns a confirmation message and the updated/created dataset details to the user.

Data Stores (Referenced in the Level 1 DFD):

D1 — User Database
Stores user accounts and authentication sessions (tokens, expiry, revocation).

D2 — Dataset Database
Stores dataset metadata and content as versioned snapshots, including dataset versions (JSON snapshots) and dataset action/audit logs.

### Data Dictionary tables (paste-ready)

Table 1.1 Users

- id (Integer, PK)
- username (Varchar, Unique)
- password_hash (Varchar)
- created_at (Timestamp)

Table 1.2 Auth Sessions

- id (Integer, PK)
- user_id (Integer, FK -> users.id)
- token_hash (Varchar, Unique)
- created_at (Timestamp)
- expires_at (Timestamp)
- revoked_at (Timestamp, Nullable)

Table 1.3 Datasets

- id (Integer, PK)
- user_id (Integer, FK -> users.id)
- name (Varchar)
- file_type (Varchar)
- description (Text, Nullable)
- current_version_id (Integer, Nullable, FK -> dataset_versions.id)
- created_at (Timestamp)

Table 1.4 Dataset Versions (Snapshots)

- id (Integer, PK)
- dataset_id (Integer, FK -> datasets.id)
- version_number (Integer)
- operation_type (Varchar)
- data_snapshot (JSONB)
- created_at (Timestamp)

Table 1.5 Dataset Actions (Audit Log)

- id (Integer, PK)
- dataset_id (Integer, FK -> datasets.id)
- action_type (Varchar)
- input_params (JSONB)
- result_summary (JSONB)
- created_at (Timestamp)

---

## Functional requirements: implemented vs planned (recommended wording)

To avoid mismatches, split functional requirements into two lists.

Implemented in current prototype:

- Upload structured datasets in CSV, Excel, or JSON formats.
- Automatically detect data quality issues (missing values, duplicates, inconsistent types).
- Allow users to apply guided cleaning operations and review results.
- Allow users to save results (replace current dataset or save as a new dataset).
- Allow users to export datasets/results (CSV/XLSX/JSON).

Planned / future enhancements:

- Dataset structuring tools (grouping, sorting, summarization).
- Trend/anomaly detection using statistical/ML methods.
- Visualizations (charts/graphs) and summarized insights.
- Report generation (if required).

---

## Planned features backlog (not implemented yet)

These appeared in the CAPSTONE doc/diagrams but are not currently end-to-end implemented:

- Data analysis module (trend/anomaly)
- Insights generation
- Visualization dashboard/charts
- Report generation + export report

Recommended approach:

- Keep diagrams truthful for now.
- Implement analysis/report later and then update CAPSTONE diagrams/ERD only after DB + endpoints exist.

---

## How to continue on another device

1. Commit this file.
2. Push to GitHub.
3. On laptop: clone/pull repo.
4. Start Copilot chat and say: “Read docs/copilot-handoff.md and continue.”
