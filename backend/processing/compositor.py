# backend/processing/compositor.py
import pandas as pd

def composite_intervals(df: pd.DataFrame, length: float, value_field: str) -> pd.DataFrame:
    """Композитирование интервалов к фиксированной длине"""
    composites = []
    
    for hole_id, group in df.groupby('HoleID'):
        group = group.sort_values('From')
        depth = group['To'].max()
        cur = 0
        
        while cur < depth:
            to = min(cur + length, depth)
            mask = (group['To'] > cur) & (group['From'] < to)
            sub = group[mask]
            
            if len(sub) > 0:
                total_length = 0
                weighted_sum = 0
                for _, row in sub.iterrows():
                    overlap = min(row['To'], to) - max(row['From'], cur)
                    if overlap > 0:
                        total_length += overlap
                        weighted_sum += row[value_field] * overlap
                
                if total_length > 0:
                    composites.append({
                        'HoleID': hole_id,
                        'From': cur,
                        'To': to,
                        value_field: weighted_sum / total_length
                    })
            cur = to
    
    return pd.DataFrame(composites)
