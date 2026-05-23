# Intelligent Pattern-Based Value Recovery

## Technical Evaluation for the Smartalyze Capstone

---

## Overview

Intelligent Pattern-Based Value Recovery is a missing value imputation strategy that analyzes relationships between columns to recommend fill values based on recurring patterns in the data, rather than relying solely on global statistics (mean, median, mode).

**Example:**

| Product | Price |
|---------|-------|
| Laptop  | 7000  |
| Mouse   | 500   |
| Laptop  | NULL  |
| Laptop  | 7000  |

Since `Product = "Laptop"` consistently corresponds to `Price = 7000`, the system recommends filling the missing value with `7000` and explains: _"'Product'='Laptop' has 3 record(s); 2 of 2 known Price values are 7000 (100% consistent)."_

---

## Question 1 — What Established Techniques Relate to This Idea?

This feature sits at the intersection of several well-studied fields:

### Conditional / Stratified Mode Imputation
The closest match. Rather than filling `Price` with the global mean/mode, values are filled using the mode *within each group defined by another column*. This is also called **group-level imputation** or **within-group imputation**. It is valid when the missing values are **Missing At Random (MAR)** conditional on the grouping column — meaning the probability of `Price` being missing depends on `Product`, not on `Price` itself.

### Hot-Deck Imputation
A classic technique where a missing value is replaced with a value from a "similar" record. The pattern-based approach is a structured form of hot-deck where similarity is defined by an exact match on a categorical column rather than a distance metric.

### Association Rule Mining (Apriori / FP-Growth)
Association rules of the form `{Product=Laptop} → {Price=7000}` (support, confidence, lift) are directly related. The confidence of an association rule is equivalent to the consistency ratio used in this feature. Libraries like `mlxtend` implement these algorithms. The current implementation is simpler but captures the same core idea.

### Functional Dependency Detection (Database Theory)
In relational database theory, a **functional dependency** `A → B` means that the value of column `A` uniquely determines column `B`. Pattern-based imputation is essentially a **probabilistic relaxation** of functional dependency detection — it finds columns where A *mostly* determines B (≥70% consistency), not necessarily perfectly.

### K-Nearest Neighbors (KNN) Imputation
KNN imputation fills a missing value using the average or mode of k most similar records (by Euclidean or other distance). The pattern approach is a restricted form: it finds the k records that share the same categorical group value, then uses their mode. KNN is more general but harder to explain.

### Multiple Imputation by Chained Equations (MICE)
MICE fits a regression model for each column with missing values using all other columns as predictors. It is the gold standard for probabilistic imputation but is computationally heavy and produces non-deterministic results. Pattern imputation is deterministic and explainable — better suited for an interactive tool where users need to understand and approve each fill.

### Why the Modal Group Approach Is Right for This Capstone
- **Interpretable**: Every fill can be traced to a specific pattern (key column → value → fill)
- **Deterministic**: Same input always produces the same recommendation
- **O(n·k) complexity**: Scales linearly with rows and number of groups
- **No hyperparameters**: No k to tune, no convergence to wait for
- **Domain-agnostic**: Works on any categorical-to-numeric relationship without schema knowledge

---

## Question 2 — Is This a Valid Form of Missing Value Imputation?

**Yes, unambiguously.** This technique is formally classified as **conditional mode imputation** or **group-mean/mode imputation** in the missing data literature.

Key points:
- **MAR assumption**: It is valid when missingness in the target column depends on the values in the key column (MAR), not on the missing values themselves (MNAR). In the `Product → Price` example, if prices are more likely to be missing for Laptops than Mice (e.g., data entry lag for higher-value items), the MAR assumption holds and group-mode imputation is statistically appropriate.
- **Better than MCAR-assuming methods**: Mean/median imputation implicitly assumes data is Missing Completely At Random (MCAR). Group-mode imputation relaxes this assumption and produces lower-bias estimates when groups genuinely differ.
- **Cited in literature**: van Buuren (2018) *Flexible Imputation of Missing Data* explicitly discusses within-group imputation as a legitimate strategy. Little & Rubin (2019) *Statistical Analysis with Missing Data* provide the theoretical foundation for MAR-based methods.
- **Used in practice**: Kaggle competition winners, healthcare EHR imputation pipelines, and retail demand forecasting all use variants of this approach.

---

## Question 3 — What Algorithms Are Most Appropriate?

### Tier 1 (Implemented — Recommended for Capstone)
**Modal value per group** (current implementation):
```
For each group g in key_column:
    fill_value[g] = mode(target_column where key_column == g and target_column is not null)
```
- Time complexity: O(n · number_of_groups)
- Space: O(number_of_groups)
- Explainability: perfect — each fill maps to a specific group mode

### Tier 2 (Enhancement Path)
**Weighted KNN within group**: instead of the mode, use the mean/median of the k records most similar to the target row (by other numeric columns). Handles multi-modal distributions better.

**Weighted voting across correlated columns**: if multiple columns predict `Price` (e.g., both `Product` and `Category`), combine their votes with confidence-weighted averaging.

### Tier 3 (Advanced / Future Work)
**Decision tree imputation**: train a decision tree with the target column as the label and all other columns as features. Inherently discovers multi-column relationships.

**Association rule mining (Apriori)**: find all rules `{col1=v1, col2=v2} → {target=v3}` with high confidence. Handles compound conditions.

**MICE (scikit-learn `IterativeImputer`)**: full probabilistic imputation using chained regression models. Best accuracy but least explainability.

---

## Question 4 — How Should Confidence Scores Be Calculated?

Two **orthogonal** measures are needed:

### Coverage Ratio (already implemented)
> "How many records in this group have a known value?"

```
coverage = support_count / (support_count + fillable_count)
```

High coverage means we have enough data to make a recommendation. Low coverage means the pattern is based on very few known examples.

### Consistency Ratio (new)
> "Among known records in this group, how many agree on the fill value?"

```
consistency_count = count(known_values == fill_value)
consistency_ratio = consistency_count / support_count
```

High consistency means the modal value is unambiguous. Low consistency (e.g., 40% 7000, 30% 6500, 30% 8000) means the fill value is disputed and should be flagged.

### Combined Score (geometric mean)
```
weighted_confidence = sqrt(coverage * consistency_ratio)
```

The geometric mean penalizes both dimensions: a pattern needs both sufficient known data AND agreement on the fill value to score highly. Using arithmetic mean would allow a group with perfect consistency but only 1 known value to score as high as a group with 100 known values.

### Low Sample Flag
Groups where `support_count < 5` are flagged separately. Even with high coverage and consistency, recommendations from fewer than 5 supporting records carry significant statistical uncertainty.

### Minimum Threshold
Patterns with `weighted_confidence < 0.70` are suppressed. This prevents noisy suggestions from low-data columns from cluttering the interface.

---

## Question 5 — How Can the System Automatically Discover Column Relationships?

### Current Approach
The system scans all pairs of `(categorical_column, numeric_column_with_missing)`:
- A column is considered **categorical** if it is of object dtype, non-boolean, non-datetime, and has ≤50 unique values
- A column is considered a candidate **target** if it is numeric and has at least one missing value

This is O(k_cat × k_num_missing) — efficient for most real-world datasets.

### Enhancement Path (Research Direction)

| Method | Use Case | Complexity |
|--------|----------|------------|
| **Cramér's V** | Categorical → Categorical relationships | O(n · k²) |
| **Mutual Information** | Any column type pair | O(n · k² · log n) |
| **Point-Biserial Correlation** | Binary/categorical → Numeric | O(n · k²) |
| **Pearson/Spearman Correlation** | Numeric → Numeric | O(n · k²) |
| **Chi-squared Test** | Categorical independence test | O(n · k²) |

For a capstone, the current approach (categorical → numeric) covers the most common real-world case and is the most explainable to a defense panel.

### Discovery Constraints That Prevent Noise
- `≤50 unique values` for key column: prevents ID columns and free-text columns from being used as group keys
- `weighted_confidence ≥ 0.70` threshold: suppresses weak patterns
- `support_count < 5` flag: warns when a group has too little data to generalize from

---

## Question 6 — What Edge Cases and Risks Should Be Handled?

| Edge Case | Risk | How Handled |
|-----------|------|-------------|
| **Multi-modal distribution** | Fill value is ambiguous (e.g., 50/50 split) | `consistency_ratio` exposes this; low consistency patterns are visually flagged |
| **Low sample group** | Recommendation from only 1–2 known records | `low_sample_groups` list returned per suggestion; UI shows warning tooltip |
| **Zero known values in group** | Division by zero; no fill value | Skipped — groups with `len(known) == 0` are excluded in `_analyze_pair` |
| **All values identical** | Trivial case with misleading 100% confidence | Valid — actually the strongest possible pattern |
| **Numeric target stored as text** | `fill_pattern` requires a numeric-dtype column | User must apply `convert_column_type` first; otherwise the operation will silently skip if the column is non-numeric after pandas reads it |
| **Operation ordering** | If `fill_mean` runs before `fill_pattern`, the target may have no nulls left | Handled naturally: `fillable_count` will be 0, suggestion suppressed |
| **Very wide datasets** | O(k_cat × k_num) scanning time | 50-unique-value cap limits categorical candidates; most real datasets have <5 categorical columns |
| **Data leakage** | Using a column to fill another that it was derived from | Not applicable here — we fill the raw source dataset, not derived features |
| **Circular relationships** | A → B and B → A simultaneously | Not possible in this one-way fill pattern; the target column must have missing values |

---

## Question 7 — Academic Value for a BSIT Capstone

**Yes — this feature provides significant novelty and academic value.** Here is why:

### What Makes It Novel
1. **Automated pattern discovery**: Most imputation tools require the user to manually specify which column to use for filling. Smartalyze automatically discovers which categorical columns reliably predict numeric targets.
2. **Dual-metric confidence scoring**: The combination of coverage ratio + consistency ratio into a geometric-mean score is a well-motivated formulation not commonly found in off-the-shelf tools.
3. **Human-readable explanations per group**: Tools like `pandas` `fillna(df.groupby(...).transform('mode'))` are one-liners but produce no explanation. Smartalyze generates per-group natural language explanations that justify each recommendation.
4. **Interactive web-based UI**: The user can see all groups, their fill values, and confidence before applying — a level of transparency not present in most data science notebooks.

### Evaluation Methodology (for Capstone Defense)
To validate the feature empirically:
1. Take a complete dataset (no missing values)
2. Randomly mask 10–20% of numeric values (create artificial missing values)
3. Run three imputation strategies: mean, median, mode, and pattern-based
4. Compare RMSE of recovered values vs. true values
5. Expect pattern-based to outperform global statistics wherever a strong categorical relationship exists

This constitutes a **comparative experimental study** — a recognized capstone contribution type.

### Research Contribution Framing
> "We propose and implement an interactive, domain-agnostic, pattern-driven conditional imputation module that automatically discovers categorical-to-numeric relationships, scores them using a dual coverage-consistency metric, and generates per-group natural language explanations. We evaluate this module against three baseline imputation strategies across [N] datasets from [M] domains."

---

## Question 8 — Technical Architecture within FastAPI + PostgreSQL + React/Next.js

### Backend (FastAPI + Pandas)
```
POST /clean/detect
  └── detect_cleaning_issues()
        └── find_pattern_suggestions(df, cols_with_missing)
              └── _analyze_pair(df, key_col, target_col) × all valid pairs
              └── Returns: list[PatternImputationResult]

POST /clean/apply
  └── apply_cleaning_operations(frame, operations)
        └── _apply_operation(frame, op) where op.operation_type == "fill_pattern"
              └── apply_pattern_fill(frame, key_col, target_col)
  └── find_pattern_suggestions(cleaned_frame, remaining_missing_cols)
  └── Returns: CleanApplyResponse (includes updated pattern_suggestions)
```

- **Stateless**: Pattern detection runs on the in-memory DataFrame every time. No DB columns or tables are needed for patterns — they are computed on demand.
- **PostgreSQL**: Unchanged. Patterns are ephemeral session data, not persisted.

### Frontend (React/Next.js)
```
cleaningDetection (state: CleanDetectResponse | CleanApplyResponse)
  └── pattern_suggestions: PatternImputationResult[]
        └── Rendered in "Smart Fill" teal panel
              └── Per-suggestion: confidence%, consistency%, key→target columns
              └── Per-group: key_value, fill_value, explanation string
              └── "Add" button → togglePatternImputation(target_col, key_col)
                    └── Queues CleaningOperation { operation_type: "fill_pattern", column: target_col, key_column: key_col }
```

- **No new state**: `cleaningDetection` is already set on every `/detect` and `/apply` call. Adding `pattern_suggestions` to `CleanApplyResponse` makes the panel auto-refresh after every Apply.
- **No new endpoints**: The `fill_pattern` operation type already exists in the backend and is handled by `apply_pattern_fill()`.

### Data Flow Diagram
```
User uploads CSV → /dataset/{id}/upload → DatasetVersion (JSONB snapshot)
User clicks "Scan" → /clean/detect → CleanDetectResponse.pattern_suggestions → Smart Fill panel
User queues fill_pattern op → UI state (cleaningOperations[])
User clicks "Apply" → /clean/apply → apply_pattern_fill() → updated CleanApplyResponse.pattern_suggestions → Smart Fill panel refreshes
User clicks "Save" → /dataset/{id}/result → new DatasetVersion persisted
```

---

## Question 9 — Defense Justification

### How to Frame It
> "Intelligent Pattern-Based Value Recovery is a **knowledge-guided conditional imputation** technique. Rather than treating all missing values the same way, our system discovers which columns carry contextual information about the missing values and uses that context to make more accurate, explainable recommendations."

### Key Points for the Panel
1. **Grounded in theory**: MAR assumption, conditional mode imputation — cite van Buuren (2018) and Little & Rubin (2019)
2. **Better than baselines when patterns exist**: Show your RMSE comparison table
3. **Explainability is a feature**: Healthcare, finance, and education datasets often require audit trails. "I filled Price with 7000 because Product='Laptop' appeared 20 times and 19 records agreed" is auditable. "I filled with the column mean of 4250" is not.
4. **Domain agnostic**: No schema knowledge needed. Works on sales, education, healthcare, inventory, finance datasets without reconfiguration.
5. **Part of a larger pipeline**: This is one module in a full data cleaning and analysis system — emphasize the end-to-end workflow.

### References to Cite
- van Buuren, S. (2018). *Flexible Imputation of Missing Data* (2nd ed.). CRC Press. [Available free online at https://stefvanbuuren.name/fimd/]
- Little, R. J. A., & Rubin, D. B. (2019). *Statistical Analysis with Missing Data* (3rd ed.). Wiley.
- Sefidian, A. M., & Daneshpour, N. (2019). Missing value imputation using a novel grey based fuzzy c-means, mutual information based feature selection, and regression model. *Expert Systems with Applications*, 115, 68–94.
- Troyanskaya, O., et al. (2001). Missing value estimation methods for DNA microarrays. *Bioinformatics*, 17(6), 520–525. (KNN imputation benchmark)

---

## Implementation Notes

### Current Status in Smartalyze
| Component | Status |
|-----------|--------|
| `find_pattern_suggestions()` backend service | Implemented |
| `apply_pattern_fill()` backend service | Implemented |
| `fill_pattern` operation type + API schema | Implemented |
| Smart Fill UI panel (frontend) | Implemented |
| `consistency_ratio` per group | **New — this document** |
| Per-group `explanation` string | **New — this document** |
| `pattern_suggestions` in Apply response | **New — this document** |

### Confidence Threshold
The current minimum threshold is `_MIN_CONFIDENCE = 0.70` (70%). This was chosen empirically as a practical balance between recall (showing enough suggestions) and precision (avoiding noisy suggestions). For the capstone evaluation, this threshold can be treated as a hyperparameter and tested at 0.60, 0.70, 0.80, and 0.90.
