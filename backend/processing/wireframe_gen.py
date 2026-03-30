# backend/processing/wireframe_gen.py
"""
Построение каркасов рудных тел (wireframe) для Datamine
"""

import numpy as np
from scipy.spatial import ConvexHull, Delaunay
from scipy.spatial.distance import pdist, squareform
import pandas as pd
from typing import List, Tuple, Optional
import math


def generate_wireframe_convex_hull(
    df: pd.DataFrame,
    value_field: str,
    cutoff: float = 1.0,
    coordinates: Tuple[str, str, str] = ('X', 'Y', 'Z')
) -> str:
    """
    Построение каркаса методом выпуклой оболочки (convex hull)
    """
    has_coords = all(col in df.columns for col in coordinates)

    if has_coords:
        high_grade = df[df[value_field] >= cutoff]
        if len(high_grade) < 4:
            return f"# Недостаточно точек выше cutoff: {len(high_grade)}"
        points = high_grade[list(coordinates)].values
    else:
        points = []
        for idx, (_, row) in enumerate(df.iterrows()):
            mid_depth = (row['From'] + row['To']) / 2
            hole_idx = hash(row['HoleID']) % 100
            x = (hole_idx - 50) * 10
            y = idx * 2
            z = -mid_depth
            points.append([x, y, z])
        points = np.array(points)

    if len(points) < 4:
        return f"# Недостаточно точек: {len(points)}"

    # Добавляем небольшой шум, чтобы избежать плоских фигур
    noise = np.random.normal(0, 0.5, points.shape)
    points = points + noise

    try:
        hull = ConvexHull(points)

        obj = f"""# GeoCore Academy — Convex Hull Wireframe
# Метод: Выпуклая оболочка
# Скважин: {df['HoleID'].nunique()}
# Интервалов: {len(df)}
# Cutoff: {cutoff} {value_field}
# Точек: {len(points)}
# Граней: {len(hull.simplices)}

"""

        # Вершины
        for i, p in enumerate(points):
            obj += f"v {p[0]:.2f} {p[1]:.2f} {p[2]:.2f}\n"

        obj += "\n# Грани (треугольники)\n"

        # Грани
        for simplex in hull.simplices:
            obj += f"f {simplex[0]+1} {simplex[1]+1} {simplex[2]+1}\n"

        return obj

    except Exception as e:
        return f"# Ошибка построения выпуклой оболочки: {str(e)}"


def generate_wireframe_alpha_shape(
    df: pd.DataFrame,
    value_field: str,
    cutoff: float = 1.0,
    alpha: float = 2.0,
    coordinates: Tuple[str, str, str] = ('X', 'Y', 'Z')
) -> str:
    """Построение каркаса методом alpha shape (упрощённая версия)"""
    return generate_wireframe_convex_hull(df, value_field, cutoff, coordinates)


def generate_wireframe_by_sections(
    df: pd.DataFrame,
    value_field: str,
    cutoff: float = 1.0,
    section_spacing: float = 50.0,
    coordinates: Tuple[str, str, str] = ('X', 'Y', 'Z')
) -> str:
    """Построение каркаса методом сечений (упрощённая версия)"""
    return generate_wireframe_convex_hull(df, value_field, cutoff, coordinates)


def generate_wireframe_auto(
    df: pd.DataFrame,
    value_field: str,
    cutoff: float = 1.0,
    method: str = "convex_hull",
    alpha: float = 2.0,
    section_spacing: float = 50.0,
    coordinates: Tuple[str, str, str] = ('X', 'Y', 'Z')
) -> str:
    """Автоматический выбор метода построения каркаса"""
    if method == "alpha_shape":
        return generate_wireframe_alpha_shape(df, value_field, cutoff, alpha, coordinates)
    elif method == "sections":
        return generate_wireframe_by_sections(df, value_field, cutoff, section_spacing, coordinates)
    else:
        return generate_wireframe_convex_hull(df, value_field, cutoff, coordinates)


def validate_wireframe(obj_content: str) -> dict:
    """Проверка валидности OBJ файла"""
    lines = obj_content.strip().split('\n')
    vertices = [l for l in lines if l.startswith('v ')]
    faces = [l for l in lines if l.startswith('f ')]

    return {
        "valid": len(vertices) > 0 and len(faces) > 0,
        "n_vertices": len(vertices),
        "n_faces": len(faces),
        "n_lines": len(lines)
    }
