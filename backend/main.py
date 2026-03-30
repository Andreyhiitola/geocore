# backend/main.py
from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
import pandas as pd
import io
from typing import Optional

# Импортируем наши модули
from processing.validator import validate_csv
from processing.compositor import composite_intervals
from processing.decluster import apply_declustering, calculate_declustered_statistics
from processing.wireframe_gen import (
    generate_wireframe_convex_hull,
    generate_wireframe_alpha_shape,
    generate_wireframe_by_sections,
    generate_wireframe_auto,
    validate_wireframe
)
from processing.mac_generator import (
    generate_mac,
    generate_mac_simple,
    generate_mac_with_variogram,
    generate_mac_for_coal,
    generate_mac_for_porphyry
)

app = FastAPI(
    title="GeoCore Lab API",
    description="API для подготовки данных к импорту в Datamine Studio RM",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {
        "service": "GeoCore Lab API",
        "version": "1.0.0",
        "endpoints": [
            "/api/health",
            "/api/validate",
            "/api/process",
            "/api/wireframe",
            "/api/mac"
        ]
    }


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "GeoCore Lab API"}


@app.post("/api/validate")
async def validate(
    file: UploadFile = File(..., description="CSV файл с данными опробования")
):
    """Только валидация CSV файла"""
    if not file.filename.endswith('.csv'):
        raise HTTPException(400, "Требуется CSV файл")
    
    content = await file.read()
    try:
        df = pd.read_csv(io.StringIO(content.decode('utf-8')))
    except Exception as e:
        raise HTTPException(400, f"Ошибка чтения CSV: {str(e)}")
    
    result = validate_csv(df)
    return result


@app.post("/api/process")
async def process(
    file: UploadFile = File(..., description="CSV файл с данными опробования"),
    composite_length: float = Form(2.0, description="Длина композита (м)"),
    cutoff: float = Form(1.0, description="Пороговое значение содержания"),
    decluster_method: str = Form("cell", description="Метод декластеризации (cell/polygon/distance)"),
    wireframe_method: str = Form("convex_hull", description="Метод построения каркаса"),
    mac_style: str = Form("standard", description="Стиль .mac скрипта"),
    block_size: float = Form(5.0, description="Размер блока модели (м)")
):
    """Полная обработка данных"""
    if not file.filename.endswith('.csv'):
        raise HTTPException(400, "Требуется CSV файл")
    
    content = await file.read()
    try:
        df = pd.read_csv(io.StringIO(content.decode('utf-8')))
    except Exception as e:
        raise HTTPException(400, f"Ошибка чтения CSV: {str(e)}")
    
    # 1. Валидация
    validation = validate_csv(df)
    if not validation["valid"]:
        return JSONResponse(
            status_code=400,
            content={"status": "error", "validation": validation}
        )
    
    value_field = validation["value_field"]
    
    # 2. Композитирование
    composites_df = composite_intervals(df, composite_length, value_field)
    
    # 3. Декластеризация
    if decluster_method != "none":
        composites_df = apply_declustering(
            composites_df, 
            value_field, 
            method=decluster_method
        )
        decluster_stats = calculate_declustered_statistics(composites_df, value_field)
    else:
        decluster_stats = None
    
    # 4. Построение каркаса
    if wireframe_method == "alpha_shape":
        wireframe_obj = generate_wireframe_alpha_shape(composites_df, value_field, cutoff)
    elif wireframe_method == "sections":
        wireframe_obj = generate_wireframe_by_sections(composites_df, value_field, cutoff)
    else:
        wireframe_obj = generate_wireframe_convex_hull(composites_df, value_field, cutoff)
    
    # 5. Генерация .mac скрипта
    if mac_style == "simple":
        mac_script = generate_mac_simple(composites_df, composite_length, cutoff, value_field)
    elif mac_style == "variogram":
        mac_script = generate_mac_with_variogram(composites_df, composite_length, cutoff, value_field)
    elif mac_style == "coal":
        mac_script = generate_mac_for_coal(composites_df, composite_length, cutoff)
    elif mac_style == "porphyry":
        mac_script = generate_mac_for_porphyry(composites_df, composite_length, cutoff, cutoff)
    else:
        mac_script = generate_mac(composites_df, composite_length, cutoff, value_field, block_size)
    
    return {
        "status": "success",
        "validation": validation,
        "composite": {
            "n_intervals": len(composites_df),
            "length": composite_length,
            "data_preview": composites_df.head(10).to_dict(orient='records')
        },
        "decluster": decluster_stats,
        "wireframe": {
            "content": wireframe_obj[:1000] + "..." if len(wireframe_obj) > 1000 else wireframe_obj,
            "full_length": len(wireframe_obj)
        },
        "mac_script": mac_script,
        "stats": validation["stats"]
    }


@app.post("/api/wireframe")
async def generate_wireframe_only(
    file: UploadFile = File(...),
    cutoff: float = Form(1.0),
    method: str = Form("convex_hull")
):
    """Только построение каркаса OBJ"""
    content = await file.read()
    try:
        df = pd.read_csv(io.StringIO(content.decode('utf-8')))
    except Exception as e:
        raise HTTPException(400, f"Ошибка чтения CSV: {str(e)}")
    
    validation = validate_csv(df)
    if not validation["valid"]:
        return JSONResponse(status_code=400, content=validation)
    
    value_field = validation["value_field"]
    
    if method == "alpha_shape":
        obj = generate_wireframe_alpha_shape(df, value_field, cutoff)
    elif method == "sections":
        obj = generate_wireframe_by_sections(df, value_field, cutoff)
    else:
        obj = generate_wireframe_convex_hull(df, value_field, cutoff)
    
    return PlainTextResponse(obj, media_type="text/plain")


@app.post("/api/mac")
async def generate_mac_only(
    file: UploadFile = File(...),
    composite_length: float = Form(2.0),
    cutoff: float = Form(1.0),
    style: str = Form("standard")
):
    """Только генерация .mac скрипта"""
    content = await file.read()
    try:
        df = pd.read_csv(io.StringIO(content.decode('utf-8')))
    except Exception as e:
        raise HTTPException(400, f"Ошибка чтения CSV: {str(e)}")
    
    validation = validate_csv(df)
    if not validation["valid"]:
        return JSONResponse(status_code=400, content=validation)
    
    value_field = validation["value_field"]
    
    if style == "simple":
        mac = generate_mac_simple(df, composite_length, cutoff, value_field)
    elif style == "variogram":
        mac = generate_mac_with_variogram(df, composite_length, cutoff, value_field)
    elif style == "coal":
        mac = generate_mac_for_coal(df, composite_length, cutoff)
    elif style == "porphyry":
        mac = generate_mac_for_porphyry(df, composite_length, cutoff, cutoff)
    else:
        mac = generate_mac(df, composite_length, cutoff, value_field)
    
    return PlainTextResponse(mac, media_type="text/plain")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
