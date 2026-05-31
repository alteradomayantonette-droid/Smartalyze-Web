# Capstone Document Issues — CAPSTONE DOCUMENT_2.pdf

Identified from full document review (Chapters 1 & 2). Prioritized for correction before panel defense.

---

## Critical — Fix Before Submission

### 1. Yellow Highlighted Text Left in Document
- **Where:** Page 3 (two full paragraphs — UK National Data Strategy and Singapore Smart Nation examples), and References [4] and [5] on the references page
- **Problem:** Review/annotation markup was never removed. Looks unprofessional in a submitted document.
- **Fix:** Remove all yellow highlighting before final export.

### 2. "Cited by: XX" Left in Reference List
- **Where:** References page — [1] says "Cited by: 76", [2] says "Cited by: 12", [6] says "Cited by: 128"
- **Problem:** These are Google Scholar citation counts that were accidentally copied into the reference list.
- **Fix:** Delete all "Cited by: XX" annotations from every reference entry.

### 3. Reference Numbers Don't Match Their In-Text Citations
- **Where:** Throughout Chapter 1 Background section, starting from [3] onward
- **Problem:** The reference list was shuffled at some point and never reconciled. Specific mismatches:

| In-Text Citation | Claim Being Cited | Actual Reference [#] | Correct? |
|---|---|---|---|
| [3] | "Data Democracy" principle | DICT National Cybersecurity Plan 2023-2028 | ❌ Unrelated |
| [6] | Philippine Development Plan + DOST agenda | Auto-Prep IEEE paper (Bilal et al.) | ❌ Unrelated |
| [7] | National Cybersecurity Plan + e-Governance Act | McKinsey "Democratization of Data" report | ❌ Unrelated |
| [8] | UN SDGs alignment | AutoMind IEEE paper | ❌ Unrelated |
| [9] | DNSC / local data-preparation challenges | Sahithya AI-powered fix suggestions paper | ❌ Unrelated |

- **Fix:** Reconcile every in-text citation number against the reference list. Re-number or re-assign references so each citation matches what it actually claims.

---

## Significant — Fix Before Defense

### 4. DFD Level 1 Is Missing Two Entire Modules
- **Where:** Chapter 2, Level 1 DFD (page 30)
- **Problem:** The DFD shows only 5 processes (Authentication, Dataset Management, Data Cleaning, Export, Save Result). Two fully implemented modules are completely absent:
  - **Analysis & Prediction** — covers stats, trends, anomalies, correlation, predictions (directly maps to Objective 3 and 4)
  - **AI Advisory** — covers Ollama/Groq/Gemini suggestions and chat (uses an external LLM entity that appears nowhere in the diagram)
- **Fix:** Add Process 6.0 Data Analysis & Prediction and Process 7.0 AI Advisory to the Level 1 DFD, plus the LLM Provider as an external entity.

### 5. CFD (Level 0) Doesn't Reflect the Full System
- **Where:** Chapter 2, Context Flow Diagram (page 27)
- **Problem:** Data inflow shows only "Dataset File" and "Cleaning Request". Data outflow shows only "Cleaning Results" and "Exported Dataset". The system also handles authentication, analysis requests, predictions, and AI chat — none of which cross the system boundary in the diagram.
- **Fix:** Update the CFD to include all data flows: credentials, analysis requests, AI questions, auth tokens, analysis results, AI suggestions.

### 6. Scope/Limitation Statement Contradicts the Implementation
- **Where:** Chapter 1, Scope and Limitation section (page 8)
- **Problem:** States "the current prototype does not include... integration with external analytics platforms." The system integrates with three external LLM providers (Ollama, Groq, Gemini), which are external platform integrations.
- **Fix:** Revise the limitation to accurately reflect that AI advisory uses external LLM providers, or clarify "analytics platforms" to mean BI tools like Tableau/Power BI.

---

## Minor — Fix When Possible

### 7. Typo in Table 1.3 Datasets (page 35)
- "**Foriegn Key**" → should be "**Foreign Key**"

### 8. Typo in Table 1.2 AuthSessions (page 34)
- "**Data** and time the session is created" → should be "**Date** and time"

### 9. Data Dictionary Is Incomplete — Missing `avatar` Field
- **Where:** Table 1.1 Users (page 33)
- **Problem:** The `avatar` column (base64 data URL, max 1MB) exists in the actual `users` table in the database but is not listed in the Data Dictionary.
- **Fix:** Add `avatar` row to Table 1.1.

### 10. Gantt Chart vs Cover Page Date Mismatch
- **Where:** Gantt chart (page 21) shows completion in **May 2026**; cover page (page 2) states **June 2026**
- **Fix:** Align both to the correct target date.

---

## Status Tracker

| # | Issue | Status |
|---|---|---|
| 1 | Remove yellow highlights | ⬜ Pending |
| 2 | Remove "Cited by" from references | ⬜ Pending |
| 3 | Fix scrambled reference numbers | ⬜ Pending |
| 4 | Add Analysis & AI modules to DFD L1 | ⬜ Pending |
| 5 | Update CFD to reflect full system | ⬜ Pending |
| 6 | Fix scope/limitation contradiction | ⬜ Pending |
| 7 | Fix "Foriegn Key" typo | ⬜ Pending |
| 8 | Fix "Data and time" typo | ⬜ Pending |
| 9 | Add avatar field to Data Dictionary | ⬜ Pending |
| 10 | Align Gantt chart and cover page date | ⬜ Pending |
