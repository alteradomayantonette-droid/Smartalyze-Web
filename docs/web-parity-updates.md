# Smartalyze Web — Feature Parity Updates

> This document tracks all features from Smartalyze-Mobile that are being ported to Smartalyze-Web.
> Reference: `c:\Users\geanr\Documents\Smartalyze-Mobile`

---

## Current State (After 2026-05-02 Session)

### Already Implemented in Web
| Feature | Web Status | Mobile Equivalent |
|---|---|---|
| User registration / login | ✅ Done | LoginScreen |
| Dataset upload (CSV/XLSX/JSON) | ✅ Done | Dashboard upload FAB |
| Dataset list + delete | ✅ Done | Dashboard dataset list |
| Dataset workspace | ✅ Done | DatasetScreen |
| Data cleaning (detect + apply) | ✅ Done | Clean panel |
| Export (CSV/XLSX/JSON) | ✅ Done | Export panel |
| Save result (replace or new dataset) | ✅ Done | Save options |
| Column statistics (Analysis tab) | ✅ Done (today) | Analyze panel |
| Group-by aggregation (Aggregation tab) | ✅ Done (today) | Aggregate panel |
| Dashboard summary cards + data alerts | ✅ Done | Dashboard stats |

---

## Missing Features (To Be Implemented)

### 1. Trend Analysis Tab
**Mobile:** Dataset Screen → Trends panel
**Priority:** High — directly addresses Capstone Objective 4 (visualizations + trend detection)

**Backend required:**
- `POST /dataset/{id}/trend`
- Request: `{ dataset_version_id?: int }`
- Response: `{ columns: ColumnTrendResult[] }`
- Each `ColumnTrendResult`: `{ column, direction, slope, r_squared, min, max, mean, count, chart_points: [{x,y}], trend_line: [{x,y}] }`
- Direction: `"increasing" | "decreasing" | "stable" | "volatile"`
- Algorithm: NumPy `polyfit` (linear regression), R² computation

**Frontend required:**
- New "Trends" tab in dataset workspace
- Column selector dropdown (numeric columns only)
- Direction badge (color-coded: green = increasing, red = decreasing, yellow = stable, orange = volatile)
- Stats row: slope, R², min, max, mean, data points
- SVG line chart: data points (blue line) + dashed trend line (red/green depending on direction)

**Files:** `backend/app/services/analysis_service.py`, `backend/app/routes/analysis.py`, `frontend/lib/api.ts`, `frontend/app/dataset/[id]/page.tsx`

---

### 2. Anomaly Detection Tab
**Mobile:** Dataset Screen → Anomaly panel
**Priority:** High — directly addresses Capstone Objective 4 (anomaly detection / ML techniques)

**Backend required:**
- `POST /dataset/{id}/anomaly`
- Request: `{ dataset_version_id?: int }`
- Response: `{ total_flagged_rows: int, columns_analyzed: int, columns: ColumnAnomalyResult[] }`
- Each `ColumnAnomalyResult`: `{ column, outlier_count, total_count, outlier_pct, lower_fence, upper_fence, sample_outliers: any[] }`
- Algorithm: IQR method — `lower = Q1 - 1.5*IQR`, `upper = Q3 + 1.5*IQR`
- Only runs on numeric columns

**Frontend required:**
- New "Anomaly" tab in dataset workspace
- Summary cards: total flagged rows, columns analyzed
- Per-column table: column name, outlier count, percentage, lower/upper fence values
- Visual bar (percentage fill) per row showing outlier proportion
- Sample outlier values inline

**Files:** `backend/app/services/analysis_service.py`, `backend/app/routes/analysis.py`, `frontend/lib/api.ts`, `frontend/app/dataset/[id]/page.tsx`

---

### 3. Profile / Settings Page
**Mobile:** Settings Screen
**Priority:** High — core user experience requirement

**Backend required (new auth endpoints):**
- `PUT /me/username` — payload: `{ new_username: str, password: str }`
- `PUT /me/password` — payload: `{ current_password: str, new_password: str }`
- `PUT /me/avatar` — payload: `{ avatar: str }` (base64 data URL)
- `DELETE /me` — payload: `{ password: str }` (account deletion with password confirmation)

**Also required:**
- Add `avatar: str | None` column to `users` table ORM model (already exists in DB schema per schema.sql)
- Expose `avatar` field in `UserRead` schema

**Frontend required:**
- New `/profile` page
- Profile card: display username, avatar image (or initials placeholder), member since date
- Change avatar: file input → browser FileReader → base64 → PUT /me/avatar
- Change username form: new username field + current password confirmation
- Change password form: current password + new password + confirm new password
- Delete account: password confirmation modal, redirect to login on success
- Sign out button (already on dashboard, but needs to be on profile too)
- Link to profile from Navbar

**Files:** `backend/app/models/auth.py`, `backend/app/schemas/auth.py`, `backend/app/services/auth_service.py`, `backend/app/routes/auth.py`, `frontend/lib/api.ts`, `frontend/app/profile/page.tsx`, `frontend/components/Navbar.tsx`

---

### 4. Avatar in Navbar
**Mobile:** Dashboard shows username + avatar in welcome card
**Priority:** Medium — improves UX polish

**Required:**
- Display user avatar (or initials circle) in the Navbar
- Link avatar/username to `/profile`
- Update `getCurrentUser` response to include `avatar` field

**Files:** `frontend/components/Navbar.tsx`, `frontend/lib/api.ts`

---

### 5. Cleaning — Sorting Operation (Minor)
**Mobile:** Analyze panel supports sort by column ascending/descending
**Priority:** Low — nice-to-have

**Backend:** Add `ascending` field to `CleaningOperation` schema + implement `sort_column` in cleaning service
**Frontend:** Add sort control in the cleaning/analysis tab

---

## Backend Endpoints Summary

| Endpoint | Status | Feature |
|---|---|---|
| POST /register | ✅ Done | Auth |
| POST /login | ✅ Done | Auth |
| GET /me | ✅ Done | Auth |
| PUT /me/username | ❌ Missing | Profile |
| PUT /me/password | ❌ Missing | Profile |
| PUT /me/avatar | ❌ Missing | Profile |
| DELETE /me | ❌ Missing | Profile |
| POST /upload | ✅ Done | Datasets |
| GET /datasets | ✅ Done | Datasets |
| GET /dataset/{id} | ✅ Done | Datasets |
| DELETE /dataset/{id} | ✅ Done | Datasets |
| POST /dataset/{id}/result | ✅ Done | Save |
| POST /dataset/{id}/export | ✅ Done | Export |
| POST /clean/detect | ✅ Done | Cleaning |
| POST /clean/apply | ✅ Done | Cleaning |
| POST /analysis/stats | ✅ Done (today) | Analysis |
| POST /analysis/group | ✅ Done (today) | Aggregation |
| POST /dataset/{id}/trend | ❌ Missing | Trends |
| POST /dataset/{id}/anomaly | ❌ Missing | Anomaly |

---

## Frontend Pages Summary

| Page | Status | Mobile Equivalent |
|---|---|---|
| `/` | ✅ Done | — |
| `/login` | ✅ Done | LoginScreen |
| `/register` | ✅ Done | LoginScreen (toggle) |
| `/dashboard` | ✅ Done | DashboardScreen |
| `/dataset/[id]` | ✅ Done | DatasetScreen |
| `/profile` | ❌ Missing | SettingsScreen |

## Workspace Tabs Summary

| Tab | Status | Mobile Equivalent |
|---|---|---|
| Overview | ✅ Done | — |
| Cleaning | ✅ Done | Clean panel |
| Analysis | ✅ Done (today) | Analyze panel |
| Aggregation | ✅ Done (today) | Aggregate panel |
| Trends | ❌ Missing | Trends panel |
| Anomaly | ❌ Missing | Anomaly panel |
| Prediction | ⚠️ Demo stub | — |

---

## Implementation Order

1. Backend: User model avatar field
2. Backend: Profile endpoints (auth service + auth routes)
3. Backend: Trend analysis endpoint
4. Backend: Anomaly detection endpoint
5. Frontend: Update api.ts
6. Frontend: Profile page
7. Frontend: Trends + Anomaly tabs in workspace
8. Frontend: Navbar avatar + settings link
