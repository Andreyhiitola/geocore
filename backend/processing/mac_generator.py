# backend/processing/mac_generator.py
"""
Генерация .mac скриптов для Datamine Studio RM
"""

import pandas as pd
from datetime import datetime
from typing import Optional, Dict, Any


def generate_mac(
    df: pd.DataFrame,
    comp_len: float = 2.0,
    cutoff: float = 1.0,
    value_field: str = "Au_gpt",
    block_size: float = 5.0,
    origin: tuple = (-50, -25, -25),
    blocks: tuple = (20, 10, 10),
    density: float = 2.7,
    interpolation_method: str = "IDW",
    kriging_params: Optional[Dict] = None,
    report_format: str = "JORC"
) -> str:
    """
    Генерация .mac скрипта для Datamine Studio RM
    
    Args:
        df: DataFrame с данными опробования
        comp_len: длина композита (м)
        cutoff: пороговое значение содержания
        value_field: название поля с содержанием
        block_size: размер блока (м)
        origin: координаты начала блочной модели (x,y,z)
        blocks: количество блоков по осям (nx, ny, nz)
        density: плотность руды (т/м³)
        interpolation_method: метод интерполяции (IDW, KRIGING, NN)
        kriging_params: параметры кригинга (вариограмма)
        report_format: формат отчёта (JORC, ГКЗ, NI43-101)
    
    Returns:
        str: текст .mac скрипта
    """
    
    n_holes = df['HoleID'].nunique()
    n_intervals = len(df)
    
    # Определяем тип металла для отчёта
    metal_type = "Au"
    if "cu" in value_field.lower():
        metal_type = "Cu"
    elif "fe" in value_field.lower():
        metal_type = "Fe"
    elif "coal" in value_field.lower():
        metal_type = "Coal"
    
    # Вычисляем статистику
    mean_grade = df[value_field].mean() if value_field in df.columns else cutoff
    max_grade = df[value_field].max() if value_field in df.columns else cutoff * 3
    
    # Заголовок скрипта
    mac = f"""! ====================================================================
! GeoCore Academy — Datamine Macro
! ====================================================================
! Дата генерации: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
! 
! Исходные данные:
!   - Скважин: {n_holes}
!   - Интервалов: {n_intervals}
!   - Среднее содержание: {mean_grade:.3f} {value_field}
!   - Максимальное: {max_grade:.3f} {value_field}
!
! Параметры обработки:
!   - Композит: {comp_len} м
!   - Cutoff: {cutoff} {value_field}
!   - Размер блока: {block_size}×{block_size}×{block_size} м
!   - Плотность: {density} т/м³
!   - Метод: {interpolation_method}
!   - Стандарт: {report_format}
!
! ====================================================================

!PRINT "============================================================"
!PRINT "GeoCore Academy — Datamine Studio RM Macro"
!PRINT "Начало обработки: {datetime.now().strftime('%H:%M:%S')}"
!PRINT "============================================================"

! ====================================================================
! ШАГ 1: Импорт данных опробования
! ====================================================================
!PRINT ">> 1. Импорт данных из CSV..."

!READ assay.csv /CREATE=assay /FIELD=1:HOLEID,2:FROM,3:TO,4:{value_field.upper()}

! ====================================================================
! ШАГ 2: Композитирование интервалов
! ====================================================================
!PRINT ">> 2. Композитирование интервалов (длина={comp_len} м)..."

!COMP assay /LENGTH={comp_len} /FIELD={value_field.upper()} /CREATE=comp_assay

! ====================================================================
! ШАГ 3: Статистический анализ композитов
! ====================================================================
!PRINT ">> 3. Статистический анализ..."

!STAT comp_assay /FIELD={value_field.upper()} /OUT=comp_stats.txt

! ====================================================================
! ШАГ 4: Создание блочной модели
! ====================================================================
!PRINT ">> 4. Создание блочной модели (блок={block_size} м)..."

!BLKMOD /CREATE=bm /ORIGIN=({origin[0]},{origin[1]},{origin[2]}) /SIZE=({block_size},{block_size},{block_size}) /BLOCKS=({blocks[0]},{blocks[1]},{blocks[2]})

! ====================================================================
! ШАГ 5: Интерполяция содержаний
! ====================================================================
!PRINT ">> 5. Интерполяция методом {interpolation_method}..."

"""

    # Разные методы интерполяции
    if interpolation_method.upper() == "IDW":
        mac += f"""!ESTIMA /DATA=comp_assay /FIELD={value_field.upper()} /METHOD=IDW /POWER=2 /MAX=12 /MIN=3 /SEARCH=40 /MODEL=bm /CREATE=bm_est
"""
    elif interpolation_method.upper() == "KRIGING":
        mac += f"""!ESTIMA /DATA=comp_assay /FIELD={value_field.upper()} /METHOD=KRIGING /MAX=12 /MIN=3 /SEARCH=40 /VARIO=model /MODEL=bm /CREATE=bm_est
"""
    else:  # Nearest Neighbour
        mac += f"""!ESTIMA /DATA=comp_assay /FIELD={value_field.upper()} /METHOD=NN /MAX=12 /MIN=3 /SEARCH=40 /MODEL=bm /CREATE=bm_est
"""

    # Фильтрация по cutoff
    mac += f"""
! ====================================================================
! ШАГ 6: Фильтрация по cutoff ({cutoff} {value_field})
! ====================================================================
!PRINT ">> 6. Фильтрация по cutoff={cutoff}..."

!FILTER bm_est /CONDITION="{value_field.upper()} >= {cutoff}" /CREATE=bm_cut

! ====================================================================
! ШАГ 7: Подсчёт ресурсов
! ====================================================================
!PRINT ">> 7. Подсчёт ресурсов..."

!REPORT bm_cut /FIELDS={value_field.upper()},TONNES /DENSITY={density} /OUT=resource_report.txt

"""

    # Дополнительные отчёты в зависимости от стандарта
    if report_format.upper() == "JORC":
        mac += f"""
! ====================================================================
! ШАГ 8: Классификация ресурсов по JORC
! ====================================================================
!PRINT ">> 8. Классификация ресурсов (JORC)..."

!CLASSIFY bm_cut /FIELD={value_field.upper()} /METHOD=DISTANCE /CLASSES=Measured,Indicated,Inferred /RANGES=25,50,100 /OUT=jorc_classification.txt

"""
    elif report_format.upper() == "ГКЗ":
        mac += f"""
! ====================================================================
! ШАГ 8: Классификация запасов по ГКЗ
! ====================================================================
!PRINT ">> 8. Классификация запасов (ГКЗ)..."

!CLASSIFY bm_cut /FIELD={value_field.upper()} /METHOD=DENSITY /CLASSES=A,B,C1,C2 /RANGES=10,25,50,100 /OUT=gkz_classification.txt

"""
    
    # Экспорт
    mac += f"""
! ====================================================================
! ШАГ 9: Экспорт результатов
! ====================================================================
!PRINT ">> 9. Экспорт блочной модели и отчётов..."

!WRITE bm_est /FILE=blockmodel_{metal_type}.blockmodel /FORMAT=BINARY
!WRITE bm_cut /FILE=blockmodel_cut.blockmodel /FORMAT=BINARY
!EXPORT bm_cut /FILE=blocks_{metal_type}.csv /FORMAT=CSV /FIELDS=X,Y,Z,{value_field.upper()},TONNES

! ====================================================================
! ЗАВЕРШЕНИЕ
! ====================================================================
!PRINT "============================================================"
!PRINT "Моделирование завершено!"
!PRINT "Результаты:"
!PRINT "  - resource_report.txt     (подсчёт ресурсов)"
!PRINT "  - blockmodel_{metal_type}.blockmodel (полная блочная модель)"
!PRINT "  - blocks_{metal_type}.csv (блоки в формате CSV)"
!PRINT "============================================================"

!PRINT "GeoCore Academy — Datamine Macro выполнен успешно!"
"""
    
    return mac


def generate_mac_simple(
    df: pd.DataFrame,
    comp_len: float = 2.0,
    cutoff: float = 1.0,
    value_field: str = "Au_gpt"
) -> str:
    """
    Упрощённая версия .mac скрипта (минимальный набор команд)
    
    Args:
        df: DataFrame с данными
        comp_len: длина композита
        cutoff: пороговое значение
        value_field: поле с содержанием
    
    Returns:
        str: упрощённый .mac скрипт
    """
    
    return f"""! GeoCore Academy — Simplified Datamine Macro
! Скважин: {df['HoleID'].nunique()}
! Композит: {comp_len}м | Cutoff: {cutoff}

!READ assay.csv /CREATE=assay /FIELD=1:HOLEID,2:FROM,3:TO,4:{value_field.upper()}
!COMP assay /LENGTH={comp_len} /FIELD={value_field.upper()} /CREATE=comp_assay
!BLKMOD /CREATE=bm /SIZE=(5,5,5)
!ESTIMA /DATA=comp_assay /FIELD={value_field.upper()} /METHOD=IDW /MODEL=bm
!FILTER bm /CONDITION="{value_field.upper()} >= {cutoff}" /CREATE=bm_cut
!REPORT bm_cut /FIELDS={value_field.upper()},TONNES /DENSITY=2.7
!PRINT "Done!"
"""


def generate_mac_with_variogram(
    df: pd.DataFrame,
    comp_len: float = 2.0,
    cutoff: float = 1.0,
    value_field: str = "Au_gpt",
    variogram_params: Dict[str, Any] = None
) -> str:
    """
    Генерация .mac скрипта с учётом вариограммы (Ordinary Kriging)
    
    Args:
        df: DataFrame с данными
        comp_len: длина композита
        cutoff: пороговое значение
        value_field: поле с содержанием
        variogram_params: параметры вариограммы (nugget, sill, range, anisotropy)
    
    Returns:
        str: .mac скрипт с настройками кригинга
    """
    
    if variogram_params is None:
        variogram_params = {
            "nugget": 0.2,
            "sill": 1.5,
            "range_major": 95,
            "range_semi": 55,
            "range_minor": 28,
            "azimuth": 45,
            "dip": 70
        }
    
    return f"""! GeoCore Academy — Kriging Macro with Variogram
! Скважин: {df['HoleID'].nunique()}
! Вариограмма: Nugget={variogram_params['nugget']}, Sill={variogram_params['sill']}
! Range: Major={variogram_params['range_major']}, Semi={variogram_params['range_semi']}, Minor={variogram_params['range_minor']}
! Анизотропия: Azimuth={variogram_params['azimuth']}, Dip={variogram_params['dip']}

!READ assay.csv /CREATE=assay /FIELD=1:HOLEID,2:FROM,3:TO,4:{value_field.upper()}
!COMP assay /LENGTH={comp_len} /FIELD={value_field.upper()} /CREATE=comp_assay

!VARIO /DATA=comp_assay /FIELD={value_field.upper()} /DIRECTION=({variogram_params['azimuth']},{variogram_params['dip']},0) /LAG=10 /N_LAGS=20 /OUT=vario_exp.txt
!MODEL /VARIO=vario_exp /NUGGET={variogram_params['nugget']} /SILL={variogram_params['sill']} /RANGE={variogram_params['range_major']} /TYPE=SPHERICAL /CREATE=vario_model

!BLKMOD /CREATE=bm /SIZE=(5,5,5)
!ESTIMA /DATA=comp_assay /FIELD={value_field.upper()} /METHOD=KRIGING /VARIO=vario_model /MODEL=bm /CREATE=bm_est
!FILTER bm_est /CONDITION="{value_field.upper()} >= {cutoff}" /CREATE=bm_cut
!REPORT bm_cut /FIELDS={value_field.upper()},TONNES /DENSITY=2.7
!WRITE bm_est /FILE=result.blockmodel /FORMAT=BINARY
!PRINT "Kriging completed!"
"""


def generate_mac_for_coal(
    df: pd.DataFrame,
    comp_len: float = 1.0,
    cutoff: float = 0.5,
    density: float = 1.3
) -> str:
    """
    Специализированный .mac скрипт для угольных месторождений
    """
    
    return f"""! GeoCore Academy — Coal Deposit Macro
! Скважин: {df['HoleID'].nunique()}
! Тип: Каменный уголь
! Плотность: {density} т/м³

!READ assay.csv /CREATE=assay /FIELD=1:HOLEID,2:FROM,3:TO,4:COAL_M
!COMP assay /LENGTH={comp_len} /FIELD=COAL_M /CREATE=comp_assay
!BLKMOD /CREATE=bm /SIZE=(10,10,2) /ORIGIN=(-100,-100,0)
!ESTIMA /DATA=comp_assay /FIELD=COAL_M /METHOD=IDW /MODEL=bm /CREATE=bm_est
!FILTER bm_est /CONDITION="COAL_M >= {cutoff}" /CREATE=bm_cut
!REPORT bm_cut /FIELDS=COAL_M,TONNES /DENSITY={density} /OUT=coal_report.txt
!WRITE bm_est /FILE=coal_model.blockmodel /FORMAT=BINARY
!PRINT "Coal modeling completed!"
"""


def generate_mac_for_porphyry(
    df: pd.DataFrame,
    comp_len: float = 5.0,
    cutoff_cu: float = 0.3,
    cutoff_au: float = 0.5
) -> str:
    """
    Специализированный .mac скрипт для медно-порфировых месторождений
    """
    
    return f"""! GeoCore Academy — Porphyry Copper Macro
! Скважин: {df['HoleID'].nunique()}
! Тип: Медно-порфировое
! Cutoff Cu: {cutoff_cu}%, Cutoff Au: {cutoff_au} г/т

!READ assay.csv /CREATE=assay /FIELD=1:HOLEID,2:FROM,3:TO,4:CU_PCT,5:AU_GPT
!COMP assay /LENGTH={comp_len} /FIELD=CU_PCT /CREATE=comp_cu
!COMP assay /LENGTH={comp_len} /FIELD=AU_GPT /CREATE=comp_au

!BLKMOD /CREATE=bm /SIZE=(10,10,5) /ORIGIN=(-200,-200,-100)
!ESTIMA /DATA=comp_cu /FIELD=CU_PCT /METHOD=IDW /MODEL=bm /CREATE=bm_cu
!ESTIMA /DATA=comp_au /FIELD=AU_GPT /METHOD=IDW /MODEL=bm /CREATE=bm_au

!FILTER bm_cu /CONDITION="CU_PCT >= {cutoff_cu}" /CREATE=bm_cu_cut
!FILTER bm_au /CONDITION="AU_GPT >= {cutoff_au}" /CREATE=bm_au_cut

!REPORT bm_cu_cut /FIELDS=CU_PCT,TONNES /DENSITY=2.8 /OUT=cu_report.txt
!REPORT bm_au_cut /FIELDS=AU_GPT,TONNES /DENSITY=2.8 /OUT=au_report.txt

!PRINT "Porphyry copper modeling completed!"
"""
