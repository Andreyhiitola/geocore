FROM python:3.11-alpine
RUN apk add --no-cache docker-cli && pip install requests PySocks --no-cache-dir
WORKDIR /app
COPY bot/bot.py .
CMD ["python", "-u", "bot.py"]
