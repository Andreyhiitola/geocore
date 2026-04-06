FROM python:3.11-slim

WORKDIR /app

# libgomp1 нужен scipy и numpy — без него будет ошибка libgomp.so.1 not found
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Сначала копируем только requirements.txt — Docker кеширует этот слой
# и не переустанавливает пакеты если код изменился, а requirements.txt нет
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Копируем весь код
COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
