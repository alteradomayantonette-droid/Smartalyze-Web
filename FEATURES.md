# Smartalyze Web — Features & Goals

Smartalyze Web is the desktop-class member of the Smartalyze family. It is the
**analytical workbench**: where wide screens, keyboards, and mice make deep,
multi-tab analysis comfortable. Smartalyze Web shares its database (Neon
PostgreSQL) and core data model with [Smartalyze Mobile](../Smartalyze-Mobile/FEATURES.md)
so the same dataset, account, and result are reachable from either client.

---

## North-Star Goal

> Let a non-technical user **clean, analyze, and understand a dataset** at
> desktop scale — without writing a single line of code.

Web is where users go to do the **heaviest** thinking: stats, trends,
anomaly hunts, and predictive modelling on the same dataset they uploaded
from their phone.

---

## Stack

- **Frontend:** Next.js 16 (App Router) · React 19 · Tailwind CSS 4 · TypeScript 5
- **Backend:** FastAPI · SQLAlchemy (async) · pandas · NumPy · scikit-learn
- **Database:** Neon PostgreSQL (cloud, shared with Mobile)
- **Auth:** PBKDF2-SHA256 (210k iterations) + hashed Bearer-token sessions

---

## Feature Matrix

### Account & Auth
- [x] Register / login with username + password
- [x] Bearer-token sessions stored hashed (SHA-256) in DB, 7-day expiry
- [x] Update username (re-verifies password)
- [x] Update password
- [x] Update / remove avatar (base64 data URL)
- [x] Delete account
- [x] `/me` self-info endpoint

### Dataset Lifecycle
- [x] Upload CSV / XLSX / XLS / JSON (≤ 20 MB by default)
- [x] List datasets with summary metadata
- [x] Workspace view (warnings + suggestions auto-computed)
- [x] Internal versioning via dataset snapshots
- [x] Save result as **replace current** or **new dataset**
- [x] Paginated row browser (`/dataset/{id}/rows`)
- [x] Delete dataset (cascade to versions + actions)
- [x] Export CSV / XLSX / JSON (with optional in-memory snapshot)

### Cleaning (`/clean/*`)
- [x] Auto-detect missing values, duplicates, inferred column types
- [x] Fill missing — **mean / median / mode**
- [x] Drop rows with missing values
- [x] Remove duplicate rows
- [x] Convert column type (numeric / string / datetime / categorical / boolean)
- [x] Trim whitespace
- [x] Lowercase column
- [x] **Standardize dates** — multi-format parser, auto day-first inference,
      pluggable output format (ISO / US / EU), unparseable handling

### Analysis (`/analysis/*`)
- [x] Per-column statistics — count, missing %, unique, **quartiles, std, top values**
- [x] Group-by + aggregate (sum / count / mean / min / max)
- [x] **Trend analysis** — linear regression on every numeric column with chart points
- [x] **Anomaly detection** — IQR-based outlier scan
- [x] **Prediction** — sklearn linear regression with confidence band

### Workspace UI (7 tabs)
- [x] Overview · Cleaning · Analysis · Aggregation · Trends · Anomaly · Prediction
- [x] Unsaved-changes banner with discard / replace / save-as flows
- [x] Type-conversion staging
- [x] Date standardization with format / day-first / unparseable controls
- [x] Sortable previews

### Dashboard
- [x] Summary cards (total datasets, with / without warnings, total rows)
- [x] Recent activity (7-day upload chart)
- [x] Per-dataset issue chips (missing / duplicate / invalid)
- [x] Inline upload + delete

---

## What Web Does Better Than Mobile

These are the capabilities Mobile **does not yet have** and which justify
loading up Web for a deep session:

1. **Predictive modelling** — Web's `/analysis/predict` endpoint runs sklearn
   linear regression with prediction intervals; Mobile has no equivalent.
2. **Per-column statistics** — quartiles, std, top values per column.
3. **Standardize-dates cleaning op** — Web auto-infers day-first vs. month-first
   and supports configurable output formats; Mobile's cleaning surface is
   simpler.
4. **Snapshot dtype preservation** — Web restores datetime / numeric / boolean
   dtypes after a JSON round-trip using stored column metadata; Mobile
   loses dtype after the round-trip.
5. **Paginated `/dataset/{id}/rows` endpoint** — Web exposes server-side
   pagination; Mobile loads previews only.

---

## What Mobile Does Better Than Web (and Web should adopt)

Web should pull these in to keep the family in sync:

1. **`change_password` revokes all sessions** (Mobile does this; Web does not).
2. **`delete_account` explicitly cascades through datasets** (Mobile does;
   Web relies on a cascade that is not currently configured in the
   `Dataset` model).
3. **Friendly `/dataset/{id}/structure/summary` endpoint** — single payload
   designed for non-technical readers (column kinds, missing cells,
   duplicates, top values).
4. **`sort_values` cleaning operation.**
5. **Dashboard polish** — gradient welcome card, "Data Alerts" stack,
   sample-dataset upload button.

---

## Roadmap (relatable across Web & Mobile)

Both clients are walking the same road. Web's leg of the journey is:

| Phase | Theme | Web milestone |
| --- | --- | --- |
| Now | **Parity & polish** | Adopt Mobile's session-revoke-on-password-change, explicit cascade on account delete, `structure/summary`, `sort_values` |
| Next | **Visualizations** | Dedicated chart components (sparkline, distribution, residuals) instead of inline canvas drawings |
| Next | **Background jobs** | Move heavy `predict` / `trend` to a task queue; stream results |
| Later | **Collaboration** | Dataset sharing & per-link read access |
| Later | **Advanced ML** | Beyond linear regression — classification, time-series |

---

## Design Principles

- **Dataset-first** — every screen is anchored to a dataset.
- **Snapshot-immutable** — operations always produce new snapshots; the user
  decides when to commit (replace) or save as a new dataset.
- **Server enforces ownership** — every route resolves the user from the
  Bearer token and re-checks `dataset.user_id`.
- **No forced workflow** — the user can clean, analyze, predict in any order.
- **Talk to humans** — warnings and suggestions read like sentences, not
  error codes.

---

## Status

`v1.x` — feature-complete for the analytical workbench. Parity work
toward Mobile is the active workstream.
