# Smartalyze

Smartalyze is an AI-assisted web-based data cleaning, analysis, and insight generation system designed for non-technical users. It allows users to upload datasets and perform powerful data operations such as cleaning, aggregation, visualization-ready analysis, and basic predictive modeling—without requiring advanced data science knowledge.

---

## Current Version: v1.0 (Initial Architecture Phase)

This version focuses on establishing the **core system architecture**, dataset workflow, and cloud-based database integration.

### Completed Setup
- Next.js frontend initialized (App Router)
- FastAPI backend setup started
- Neon PostgreSQL cloud database configured
- Environment variables (.env) integrated
- Git repository initialized
- Basic project structure created
- Dataset-centric workflow designed

---

## 🏗️ System Architecture
Frontend (Next.js + Tailwind)
To
Backend API (FastAPI)
To
PostgreSQL Database (Neon Cloud)


---

## Core Concept

Smartalyze is **dataset-centered**.

Everything revolves around a dataset:
- Upload dataset
- Open dataset workspace
- Perform actions (clean, analyze, aggregate, predict)
- Save results as versions or new datasets

---

## Core Features (Planned / In Development)

### 📤 Dataset Upload
- Supports CSV, Excel, JSON
- Stores dataset metadata in PostgreSQL

### Data Cleaning
- Detect missing values
- Identify duplicates and outliers
- Suggest cleaning actions (mean, median, mode, removal)

### Data Analysis
- Summary statistics
- Column profiling
- Trend detection

### Aggregation (Pivot-like System)
- Group by categorical fields
- Aggregations: sum, average, count, min, max

### 🤖 Predictive Analysis (Controlled ML)
- Linear regression using scikit-learn
- User-selected features and target variable
- Returns predictions + evaluation metrics

### 🧬 Dataset Versioning
- Tracks dataset history:
  - original
  - cleaned
  - aggregated
- Supports rollback and comparison

### Export System
- Export cleaned datasets (CSV)
- Export insights and analysis results

---

## Database (Neon PostgreSQL)

Smartalyze uses a cloud PostgreSQL database hosted on **Neon**.

### Core Tables:
- users
- datasets
- dataset_versions
- dataset_actions

All dataset operations and history are stored in the database for traceability and version control.

---

## Authentication (Planned)

- Custom authentication system
- Username + hashed password (bcrypt)
- Secure login/register via FastAPI
- Protected dataset dashboard

---

## Project Structure (Current)
smartalyze/
│
├── backend/
│ ├── app/
│ │ ├── main.py
│ │ ├── db.py
│ │ ├── routes/
│ │ ├── models/
│ │ └── services/
│ ├── .env
│ └── requirements.txt
│
├── frontend/
│ ├── app/
│ ├── components/
│ ├── public/
│ └── package.json
│
└── README.md


---

## Dataset Workflow

1. User uploads dataset
2. Dataset is stored in PostgreSQL (metadata + reference)
3. User opens dataset workspace
4. User performs actions:
   - Clean
   - Analyze
   - Aggregate
   - Predict
5. Result is:
   - previewed
   - saved as version OR new dataset OR exported

---

## Tech Stack

### Frontend
- Next.js (App Router)
- Tailwind CSS

### Backend
- FastAPI (Python)
- SQLAlchemy (async)
- pandas / numpy
- scikit-learn

### Database
- PostgreSQL (Neon Cloud)

---

## Key Design Principles

- Dataset-first architecture
- Modular data operations
- No forced workflow steps
- Flexible analysis system
- Version-controlled datasets
- Cloud-based database (no local DB dependency)

---

## Future Improvements

- Advanced ML models (beyond linear regression)
- Data visualization dashboard (charts)
- Background task processing (for heavy datasets)
- User roles (admin / standard user)
- Dataset sharing system

---

## Status Summary

Smartalyze is currently in **early development phase**, focusing on:

- backend foundation
- database schema design
- dataset workflow architecture

---

## Goal

To build a simple but powerful system that allows users to:
> Clean, analyze, and understand data without needing data science expertise.
