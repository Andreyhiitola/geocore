# backend/processing/__init__.py
"""
Модули обработки данных для GeoCore Lab
"""

from .validator import validate_csv
from .compositor import composite_intervals
from .wireframe_gen import (
    generate_wireframe_convex_hull,
    generate_wireframe_alpha_shape,
    generate_wireframe_by_sections,
    generate_wireframe_auto,
    validate_wireframe
)
from .mac_generator import (
    generate_mac,
    generate_mac_simple,
    generate_mac_with_variogram,
    generate_mac_for_coal,
    generate_mac_for_porphyry
)

__all__ = [
    'validate_csv',
    'composite_intervals',
    'generate_wireframe_convex_hull',
    'generate_wireframe_alpha_shape',
    'generate_wireframe_by_sections',
    'generate_wireframe_auto',
    'validate_wireframe',
    'generate_mac',
    'generate_mac_simple',
    'generate_mac_with_variogram',
    'generate_mac_for_coal',
    'generate_mac_for_porphyry'
]
