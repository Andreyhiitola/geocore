#!/bin/bash

PORT=9001
IP=$(hostname -I | awk '{print $1}')

# Убиваем процесс, занимающий порт (если есть)
fuser -k $PORT/tcp 2>/dev/null
echo "Port $PORT cleared."

echo "Starting local web server..."
echo "Local access: http://localhost:$PORT"
echo "Mobile access: http://$IP:$PORT"
echo ""
echo "Make sure your phone is on the same Wi-Fi network!"
echo "Press Ctrl+C to stop the server"
echo ""

# Запуск сервера
python3 -m http.server $PORT
