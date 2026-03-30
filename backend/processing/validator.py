# backend/processing/validator.py
import pandas as pd
import numpy as np

def validate_csv(df: pd.DataFrame) -> dict:
    """Валидация CSV данных опробования"""
    required_cols = ['HoleID', 'From', 'To']
    value_col = None
    
    # Определяем колонку с содержанием
    for col in df.columns:
        if any(x in col.lower() for x in ['au', 'cu', 'coal', 'fe']):
            value_col = col
            break
    
    if value_col is None:
        return {
            "valid": False,
            "error": "Не найдена колонка с содержанием (Au_gpt, Cu_pct, Coal_m, Fe_pct)",
            "value_field": None,
            "errors": [],
            "stats": {}
        }
    
    errors = []
    for _, row in df.iterrows():
        if row['To'] <= row['From']:
            errors.append(f"{row['HoleID']}: To ({row['To']}) <= From ({row['From']})")
        if pd.isna(row[value_col]):
            errors.append(f"{row['HoleID']}: пустое значение содержания")
        if row[value_col] < 0:
            errors.append(f"{row['HoleID']}: отрицательное содержание {row[value_col]}")
    
    # IQR выбросы
    vals = df[value_col].dropna().values
    if len(vals) > 0:
        q1, q3 = np.percentile(vals, [25, 75])
        iqr = q3 - q1
        upper = q3 + 3 * iqr
        outliers = vals[vals > upper]
        for v in outliers[:5]:
            errors.append(f"Выброс: {v:.2f} > {upper:.2f}")
    
    return {
        "valid": len(errors) == 0,
        "error": None,
        "value_field": value_col,
        "errors": errors[:20],
        "stats": {
            "n_holes": df['HoleID'].nunique(),
            "n_intervals": len(df),
            "mean": float(df[value_col].mean()),
            "max": float(df[value_col].max()),
            "min": float(df[value_col].min()),
            "std": float(df[value_col].std())
        }
    }
