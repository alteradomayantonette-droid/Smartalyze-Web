import type { CleaningOperation } from "@/lib/api";

function quoteSingle(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function quoteList(values: string[]): string {
  return `[${values.map(quoteSingle).join(", ")}]`;
}

function colsOrAll(op: CleaningOperation): string[] {
  if (op.columns && op.columns.length > 0) return op.columns;
  if (op.column) return [op.column];
  return [];
}

function operationToPandas(op: CleaningOperation, idx: number): string[] {
  const lines: string[] = [];
  const stepHeader = `# Step ${idx + 1}: ${op.operation_type}`;
  lines.push(stepHeader);

  switch (op.operation_type) {
    case "fill_mean": {
      const cols = colsOrAll(op);
      if (cols.length === 0) {
        lines.push("df = df.fillna(df.mean(numeric_only=True))");
      } else {
        lines.push(`for _col in ${quoteList(cols)}:`);
        lines.push("    df[_col] = df[_col].fillna(df[_col].mean())");
      }
      break;
    }
    case "fill_median": {
      const cols = colsOrAll(op);
      if (cols.length === 0) {
        lines.push("df = df.fillna(df.median(numeric_only=True))");
      } else {
        lines.push(`for _col in ${quoteList(cols)}:`);
        lines.push("    df[_col] = df[_col].fillna(df[_col].median())");
      }
      break;
    }
    case "fill_mode": {
      const cols = colsOrAll(op);
      const target = cols.length === 0 ? "df.columns" : quoteList(cols);
      lines.push(`for _col in ${target}:`);
      lines.push("    _modes = df[_col].mode(dropna=True)");
      lines.push("    if len(_modes) > 0:");
      lines.push("        df[_col] = df[_col].fillna(_modes.iloc[0])");
      break;
    }
    case "drop_rows": {
      const cols = colsOrAll(op);
      if (op.drop_all_missing || cols.length === 0) {
        lines.push("df = df.dropna(how='any').reset_index(drop=True)");
      } else {
        lines.push(`df = df.dropna(subset=${quoteList(cols)}).reset_index(drop=True)`);
      }
      break;
    }
    case "remove_all_duplicates": {
      lines.push("df = df.drop_duplicates().reset_index(drop=True)");
      break;
    }
    case "convert_column_type": {
      const cols = colsOrAll(op);
      const target = op.target_type ?? "string";
      const pandasMap: Record<string, string> = {
        numeric: "pd.to_numeric(df[_col], errors='coerce')",
        string: "df[_col].astype('string')",
        datetime: "pd.to_datetime(df[_col], errors='coerce')",
        categorical: "df[_col].astype('category')",
        boolean: "df[_col].astype('boolean')",
      };
      const expr = pandasMap[target] ?? "df[_col].astype('string')";
      lines.push(`for _col in ${quoteList(cols)}:`);
      lines.push(`    df[_col] = ${expr}`);
      break;
    }
    case "trim_whitespace": {
      const cols = colsOrAll(op);
      const target = cols.length === 0 ? "df.select_dtypes(include='object').columns" : quoteList(cols);
      lines.push(`for _col in ${target}:`);
      lines.push("    df[_col] = df[_col].astype('string').str.strip()");
      break;
    }
    case "lowercase_column": {
      const cols = colsOrAll(op);
      lines.push(`for _col in ${quoteList(cols)}:`);
      lines.push("    df[_col] = df[_col].astype('string').str.lower()");
      break;
    }
    case "standardize_dates": {
      const cols = colsOrAll(op);
      const fmtMap: Record<string, string> = { iso: "%Y-%m-%d", us: "%m/%d/%Y", eu: "%d/%m/%Y" };
      const fmt = op.output_format ? fmtMap[op.output_format] : "%Y-%m-%d";
      const dayfirst = op.dayfirst_hint === "day" ? "True" : op.dayfirst_hint === "month" ? "False" : "False";
      lines.push(`for _col in ${quoteList(cols)}:`);
      lines.push(`    _parsed = pd.to_datetime(df[_col], errors='coerce', dayfirst=${dayfirst})`);
      if (op.unparseable_action === "null") {
        lines.push(`    df[_col] = _parsed.dt.strftime(${quoteSingle(fmt)})`);
      } else {
        lines.push(`    df[_col] = _parsed.dt.strftime(${quoteSingle(fmt)}).fillna(df[_col])`);
      }
      break;
    }
    case "sort_values": {
      const cols = colsOrAll(op);
      const ascending = op.ascending !== false;
      lines.push(`df = df.sort_values(by=${quoteList(cols)}, ascending=${ascending ? "True" : "False"}).reset_index(drop=True)`);
      break;
    }
    case "fill_pattern": {
      const key = op.key_column ?? "";
      const target = op.target_column_fill ?? "";
      lines.push(`# Pattern fill: group by ${quoteSingle(key)}, fill missing values in ${quoteSingle(target)} with the per-group mode.`);
      lines.push(`_groups = df.groupby(${quoteSingle(key)}, dropna=True)`);
      lines.push(`def _pattern_fill(s):`);
      lines.push(`    _m = s.mode(dropna=True)`);
      lines.push(`    return s.fillna(_m.iloc[0]) if len(_m) > 0 else s`);
      lines.push(`df[${quoteSingle(target)}] = _groups[${quoteSingle(target)}].transform(_pattern_fill)`);
      break;
    }
    case "derive_column": {
      const name = op.new_column_name ?? "new_column";
      const expr = op.expression ?? "0";
      lines.push(`# Derived column from formula. df.eval supports bare column names + arithmetic;`);
      lines.push(`# if your expression uses helpers like abs/round/min/max, rewrite with df.apply.`);
      lines.push(`df[${quoteSingle(name)}] = df.eval(${quoteSingle(expr)})`);
      break;
    }
    default: {
      lines.push(`# Operation '${op.operation_type}' has no pandas translation yet.`);
    }
  }

  return lines;
}

export function operationsToPandasScript(ops: CleaningOperation[], datasetName: string): string {
  const safeName = datasetName.replace(/'/g, "");
  const header = [
    `"""Reproducible cleaning script generated by Smartalyze.`,
    ``,
    `Dataset: ${safeName}`,
    `Generated: ${new Date().toISOString()}`,
    `Operations: ${ops.length}`,
    ``,
    `Usage:`,
    `    1. Place your source file next to this script (CSV assumed).`,
    `    2. Adjust the read_* call below if your file is XLSX or JSON.`,
    `    3. Run: python ${safeName.replace(/[^A-Za-z0-9_-]/g, "_") || "cleaning_script"}.py`,
    `"""`,
    ``,
    `import pandas as pd`,
    ``,
    `# Load the dataset — update this path for your environment.`,
    `df = pd.read_csv(${quoteSingle(safeName)})`,
    ``,
  ];

  const body: string[] = [];
  if (ops.length === 0) {
    body.push(`# No cleaning operations were queued.`);
  } else {
    ops.forEach((op, idx) => {
      body.push(...operationToPandas(op, idx));
      body.push("");
    });
  }

  const footer = [
    `# Save the cleaned dataset.`,
    `df.to_csv(${quoteSingle("cleaned_" + safeName)}, index=False)`,
    `print(f"Saved cleaned dataset: {len(df)} rows, {len(df.columns)} columns.")`,
    ``,
  ];

  return [...header, ...body, ...footer].join("\n");
}
