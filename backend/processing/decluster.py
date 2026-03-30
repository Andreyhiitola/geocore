# backend/processing/decluster.py
"""
Декластеризация данных опробования
Методы:
- cell_declustering — сотовый метод (ячейка = блок модели)
- polygon_declustering — полигональный метод (Вороного)
- distance_weighted — взвешивание по расстоянию до ближайших скважин
"""

import numpy as np
import pandas as pd
from scipy.spatial import KDTree, Voronoi
from typing import Optional, Tuple, List, Dict, Any


def cell_declustering(
    df: pd.DataFrame,
    value_field: str,
    cell_size: Tuple[float, float, float] = (50.0, 50.0, 25.0),
    coordinates: Tuple[str, str, str] = ('X', 'Y', 'Z')
) -> pd.DataFrame:
    """
    Сотовый метод декластеризации
    
    Разбивает объём на ячейки заданного размера,
    каждая ячейка получает вес = 1 / (количество проб в ячейке)
    
    Args:
        df: DataFrame с данными опробования
        value_field: название колонки с содержанием
        cell_size: размер ячейки (dx, dy, dz) в метрах
        coordinates: названия колонок с координатами (X, Y, Z)
    
    Returns:
        DataFrame с добавленной колонкой 'weight' (вес пробы)
    """
    
    has_coords = all(col in df.columns for col in coordinates)
    
    if not has_coords:
        # Если нет координат, все пробы имеют одинаковый вес
        df = df.copy()
        df['weight'] = 1.0 / len(df)
        return df
    
    # Определяем границы
    x_min = df[coordinates[0]].min()
    x_max = df[coordinates[0]].max()
    y_min = df[coordinates[1]].min()
    y_max = df[coordinates[1]].max()
    z_min = df[coordinates[2]].min()
    z_max = df[coordinates[2]].max()
    
    # Вычисляем количество ячеек
    nx = max(1, int((x_max - x_min) / cell_size[0]) + 1)
    ny = max(1, int((y_max - y_min) / cell_size[1]) + 1)
    nz = max(1, int((z_max - z_min) / cell_size[2]) + 1)
    
    # Создаём массив для подсчёта проб в ячейках
    cell_counts = np.zeros((nx, ny, nz))
    cell_indices = []
    
    # Определяем индекс ячейки для каждой пробы
    for _, row in df.iterrows():
        ix = min(nx - 1, max(0, int((row[coordinates[0]] - x_min) / cell_size[0])))
        iy = min(ny - 1, max(0, int((row[coordinates[1]] - y_min) / cell_size[1])))
        iz = min(nz - 1, max(0, int((row[coordinates[2]] - z_min) / cell_size[2])))
        cell_counts[ix, iy, iz] += 1
        cell_indices.append((ix, iy, iz))
    
    # Вычисляем веса
    weights = []
    for idx in cell_indices:
        count = cell_counts[idx[0], idx[1], idx[2]]
        weight = 1.0 / count if count > 0 else 1.0
        weights.append(weight)
    
    # Нормализация (сумма весов = количество проб)
    total_weight = sum(weights)
    if total_weight > 0:
        weights = [w * len(df) / total_weight for w in weights]
    
    df = df.copy()
    df['weight'] = weights
    df['cell_x'] = [idx[0] for idx in cell_indices]
    df['cell_y'] = [idx[1] for idx in cell_indices]
    df['cell_z'] = [idx[2] for idx in cell_indices]
    
    return df


def polygon_declustering(
    df: pd.DataFrame,
    value_field: str,
    coordinates: Tuple[str, str, str] = ('X', 'Y', 'Z')
) -> pd.DataFrame:
    """
    Полигональный метод декластеризации (диаграмма Вороного)
    
    Каждая проба получает вес пропорционально площади полигона Вороного
    
    Args:
        df: DataFrame с данными опробования
        value_field: название колонки с содержанием
        coordinates: названия колонок с координатами (X, Y, Z)
    
    Returns:
        DataFrame с добавленной колонкой 'weight'
    """
    
    has_coords = all(col in df.columns for col in coordinates[:2])
    
    if not has_coords:
        df = df.copy()
        df['weight'] = 1.0 / len(df)
        return df
    
    # Используем только X, Y для 2D Вороного
    points = df[[coordinates[0], coordinates[1]]].values
    
    if len(points) < 4:
        # Слишком мало точек — равные веса
        df = df.copy()
        df['weight'] = 1.0 / len(df)
        return df
    
    try:
        # Построение диаграммы Вороного
        vor = Voronoi(points)
        
        # Вычисляем площадь каждого полигона
        areas = []
        for i, region in enumerate(vor.point_region):
            if region == -1:
                areas.append(0)
                continue
            vertices = vor.regions[region]
            if len(vertices) < 3:
                areas.append(0)
                continue
            # Вычисляем площадь полигона
            polygon = [vor.vertices[v] for v in vertices if v >= 0]
            if len(polygon) < 3:
                areas.append(0)
                continue
            area = polygon_area(polygon)
            areas.append(area)
        
        # Нормализация весов
        total_area = sum(areas)
        if total_area > 0:
            weights = [a / total_area * len(df) for a in areas]
        else:
            weights = [1.0 / len(df)] * len(df)
        
        df = df.copy()
        df['weight'] = weights
        
    except Exception as e:
        # При ошибке — равные веса
        print(f"Ошибка построения Вороного: {e}")
        df = df.copy()
        df['weight'] = 1.0 / len(df)
    
    return df


def distance_weighted_declustering(
    df: pd.DataFrame,
    value_field: str,
    radius: float = 100.0,
    coordinates: Tuple[str, str, str] = ('X', 'Y', 'Z')
) -> pd.DataFrame:
    """
    Декластеризация взвешиванием по расстоянию до соседних скважин
    
    Каждая проба получает вес = 1 / (количество проб в радиусе)
    
    Args:
        df: DataFrame с данными опробования
        value_field: название колонки с содержанием
        radius: радиус поиска соседей (м)
        coordinates: названия колонок с координатами (X, Y, Z)
    
    Returns:
        DataFrame с добавленной колонкой 'weight'
    """
    
    has_coords = all(col in df.columns for col in coordinates[:2])
    
    if not has_coords:
        df = df.copy()
        df['weight'] = 1.0 / len(df)
        return df
    
    points = df[[coordinates[0], coordinates[1], coordinates[2]]].values
    
    if len(points) < 2:
        df = df.copy()
        df['weight'] = 1.0 / len(df)
        return df
    
    try:
        tree = KDTree(points)
        weights = []
        
        for i, point in enumerate(points):
            # Находим соседей в радиусе (включая саму точку)
            indices = tree.query_ball_point(point, radius)
            n_neighbors = len(indices)
            weight = 1.0 / n_neighbors if n_neighbors > 0 else 1.0
            weights.append(weight)
        
        # Нормализация
        total_weight = sum(weights)
        if total_weight > 0:
            weights = [w * len(df) / total_weight for w in weights]
        
        df = df.copy()
        df['weight'] = weights
        
    except Exception as e:
        print(f"Ошибка distance-weighted declustering: {e}")
        df = df.copy()
        df['weight'] = 1.0 / len(df)
    
    return df


def polygon_area(polygon: List[List[float]]) -> float:
    """
    Вычисление площади полигона (формула шнурка)
    
    Args:
        polygon: список вершин [[x1,y1], [x2,y2], ...]
    
    Returns:
        float: площадь полигона
    """
    if len(polygon) < 3:
        return 0.0
    
    area = 0.0
    n = len(polygon)
    for i in range(n):
        x1, y1 = polygon[i]
        x2, y2 = polygon[(i + 1) % n]
        area += x1 * y2 - x2 * y1
    
    return abs(area) / 2.0


def apply_declustering(
    df: pd.DataFrame,
    value_field: str,
    method: str = "cell",
    cell_size: Tuple[float, float, float] = (50.0, 50.0, 25.0),
    radius: float = 100.0,
    coordinates: Tuple[str, str, str] = ('X', 'Y', 'Z')
) -> pd.DataFrame:
    """
    Унифицированный интерфейс для декластеризации
    
    Args:
        df: DataFrame с данными опробования
        value_field: название колонки с содержанием
        method: метод декластеризации (cell, polygon, distance)
        cell_size: размер ячейки (для cell)
        radius: радиус (для distance)
        coordinates: названия колонок с координатами
    
    Returns:
        DataFrame с добавленной колонкой 'weight'
    """
    
    if method == "cell":
        return cell_declustering(df, value_field, cell_size, coordinates)
    elif method == "polygon":
        return polygon_declustering(df, value_field, coordinates)
    elif method == "distance":
        return distance_weighted_declustering(df, value_field, radius, coordinates)
    else:
        # По умолчанию — равные веса
        df = df.copy()
        df['weight'] = 1.0 / len(df)
        return df


def calculate_declustered_statistics(
    df: pd.DataFrame,
    value_field: str,
    weight_field: str = 'weight'
) -> Dict[str, float]:
    """
    Вычисление взвешенной статистики после декластеризации
    
    Args:
        df: DataFrame с данными (должен содержать weight_field)
        value_field: название колонки с содержанием
        weight_field: название колонки с весами
    
    Returns:
        dict: взвешенные статистики
    """
    
    total_weight = df[weight_field].sum()
    
    if total_weight == 0:
        return {
            'mean': 0,
            'variance': 0,
            'std': 0,
            'total_weight': 0
        }
    
    # Взвешенное среднее
    weighted_mean = (df[value_field] * df[weight_field]).sum() / total_weight
    
    # Взвешенная дисперсия
    weighted_variance = ((df[value_field] - weighted_mean) ** 2 * df[weight_field]).sum() / total_weight
    
    return {
        'mean': weighted_mean,
        'variance': weighted_variance,
        'std': np.sqrt(weighted_variance),
        'total_weight': total_weight,
        'n_samples': len(df)
    }
