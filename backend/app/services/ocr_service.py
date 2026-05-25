from __future__ import annotations

import pandas as pd
from img2table.document import Image as Img2TableImage
from img2table.ocr import EasyOCR

_ocr_engine: EasyOCR | None = None


def _get_ocr() -> EasyOCR:
    global _ocr_engine
    if _ocr_engine is None:
        _ocr_engine = EasyOCR(lang=["en"], kw={"gpu": False})
    return _ocr_engine


def extract_table_from_image(image_bytes: bytes) -> pd.DataFrame:
    """
    Extract the largest detected table from an image using img2table + EasyOCR.
    Raises ValueError if no table structure is found.
    """
    ocr = _get_ocr()
    doc = Img2TableImage(src=image_bytes, detect_rotation=True)
    extracted = doc.extract_tables(
        ocr=ocr,
        implicit_rows=True,
        borderless_tables=True,
    )

    if not extracted:
        raise ValueError(
            "No table structure was detected in the image. "
            "Please upload a clear image of a data table with visible rows and columns."
        )

    # Take the table with the most cells
    best = max(extracted, key=lambda t: t.df.size)
    df: pd.DataFrame = best.df.copy()

    # Promote first row to header when it doesn't look purely numeric
    if len(df) > 1:
        first_row = df.iloc[0].astype(str)
        is_all_numeric = first_row.str.match(r"^\s*-?\d+(\.\d+)?\s*$").all()
        if not is_all_numeric:
            df.columns = first_row.tolist()
            df = df.iloc[1:].reset_index(drop=True)

    # Strip whitespace and convert empty strings to NaN
    for col in df.columns:
        if df[col].dtype == object:
            df[col] = df[col].str.strip()
    df.replace("", pd.NA, inplace=True)

    # Attempt numeric coercion on each column
    for col in df.columns:
        coerced = pd.to_numeric(df[col], errors="coerce")
        if coerced.notna().sum() / max(len(df), 1) >= 0.7:
            df[col] = coerced

    return df
