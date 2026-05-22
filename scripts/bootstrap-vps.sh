#!/bin/bash
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  GeoCore Academy — Bootstrap новой машины + восстановление из S3           ║
# ║                                                                            ║
# ║  Production (новый VPS у провайдера):                                      ║
# ║    curl -fsSL https://raw.githubusercontent.com/Andreyhiitola/geocore/main/scripts/bootstrap-vps.sh -o /tmp/bootstrap.sh && bash /tmp/bootstrap.sh --prod
# ║                                                                            ║
# ║  Локальный тест (только проверяет S3, не качает данные):                   ║
# ║    bash bootstrap-vps.sh --local                                           ║
# ║                                                                            ║
# ║  Локальный тест с реальным restore (осторожно — качает все данные):        ║
# ║    bash bootstrap-vps.sh --local --full                                    ║
# ║                                                                            ║
# ║  Флаги:                                                                    ║
# ║    --prod          production режим (restore + nginx шаги)                 ║
# ║    --local         локальный тест: dry-run по умолчанию                    ║
# ║    --full          с --local: делает реальный restore вместо dry-run       ║
# ║    --skip-restore  только окружение, без restore.sh                        ║
# ╚══════════════════════════════════════════════════════════════════════════════╝
set -euo pipefail

# ── Настройки ─────────────────────────────────────────────────────────────────
REPO_URL="https://github.com/Andreyhiitola/geocore.git"
DEPLOY_DIR="/opt/geocore"
COMPOSE_DIR="$DEPLOY_DIR"
SWAP_SIZE="2G"
DRY_RUN=false
SKIP_RESTORE=false
MODE="prod"  # prod | local

for arg in "$@"; do
    case "$arg" in
        --prod)         MODE="prod" ;;
        --local)        MODE="local"; DRY_RUN=true ;;
        --full)         DRY_RUN=false ;;  # переопределяет --local dry-run
        --skip-restore) SKIP_RESTORE=true ;;
    esac
done

# ── Цвета ─────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] WARN:${NC} $*"; }
fail() { echo -e "${RED}[$(date '+%H:%M:%S')] ERROR:${NC} $*"; exit 1; }
step() { echo -e "\n${CYAN}━━━ $* ━━━${NC}"; }

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════╗"
echo "║   GeoCore Academy — Bootstrap VPS        ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${NC}"

# ── 1. Проверка ОС ────────────────────────────────────────────────────────────
step "1. Проверка окружения"

[[ "$EUID" -eq 0 ]] && fail "Не запускай от root. Используй обычного пользователя с sudo."
command -v sudo >/dev/null || fail "sudo не найден"

OS=$(. /etc/os-release && echo "$ID $VERSION_ID")
log "ОС: $OS"
log "Пользователь: $USER"
log "Директория деплоя: $DEPLOY_DIR"
log "Режим: ${MODE}$([ "$DRY_RUN" = true ] && echo ' (dry-run — данные не качаются)' || true)"

# ── 2. Swap ───────────────────────────────────────────────────────────────────
step "2. Swap"

if swapon --show | grep -q .; then
    log "Swap уже активен: $(free -h | awk '/Swap/{print $2}')"
else
    log "Создаём swap ${SWAP_SIZE}..."
    sudo fallocate -l "$SWAP_SIZE" /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    log "Swap создан: ${SWAP_SIZE}"
fi

# ── 3. Docker ─────────────────────────────────────────────────────────────────
step "3. Docker"

if command -v docker >/dev/null 2>&1; then
    log "Docker уже установлен: $(docker --version)"
else
    log "Устанавливаем Docker..."
    sudo apt-get update -q
    sudo apt-get install -y -q ca-certificates curl gnupg

    sudo mkdir -p /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
        | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
        | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

    sudo apt-get update -q
    sudo apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-compose-plugin
    log "Docker установлен: $(docker --version)"
fi

# Добавляем в группу docker (нужен re-login, но sg позволяет продолжить без него)
if ! groups | grep -q docker; then
    sudo usermod -aG docker "$USER"
    log "Пользователь $USER добавлен в группу docker (применится после re-login)"
fi

# ── 4. AWS CLI ────────────────────────────────────────────────────────────────
step "4. AWS CLI (для S3)"

if command -v aws >/dev/null 2>&1; then
    log "AWS CLI уже установлен: $(aws --version 2>&1)"
else
    sudo apt-get install -y -q awscli
    log "AWS CLI установлен: $(aws --version 2>&1)"
fi

# ── 5. Клонирование репо ──────────────────────────────────────────────────────
step "5. Репозиторий"

if [[ -d "$DEPLOY_DIR/.git" ]]; then
    log "Репо уже существует, обновляем..."
    sudo git -C "$DEPLOY_DIR" pull --ff-only
else
    log "Клонируем $REPO_URL → $DEPLOY_DIR"
    sudo git clone "$REPO_URL" "$DEPLOY_DIR"
fi

sudo chown -R "$USER:$USER" "$DEPLOY_DIR"
log "Репо готово: $DEPLOY_DIR"

# ── 6. .env ───────────────────────────────────────────────────────────────────
step "6. Файл .env"

if [[ -f "$DEPLOY_DIR/.env" ]]; then
    log ".env уже существует — используем его."
else
    echo ""
    echo -e "${YELLOW}Вставь содержимое .env из Bitwarden.${NC}"
    echo -e "${YELLOW}Когда закончишь — введи пустую строку и нажми Enter.${NC}"
    echo ""

    ENV_LINES=()
    while IFS= read -r line; do
        [[ -z "$line" ]] && break
        ENV_LINES+=("$line")
    done

    if [[ ${#ENV_LINES[@]} -eq 0 ]]; then
        fail ".env пустой. Получи секреты из Bitwarden и запусти скрипт снова."
    fi

    printf '%s\n' "${ENV_LINES[@]}" > "$DEPLOY_DIR/.env"
    chmod 600 "$DEPLOY_DIR/.env"
    log ".env создан ($(wc -l < "$DEPLOY_DIR/.env") строк)"
fi

# Загружаем .env безопасно (source ломается на значениях с пробелами)
while IFS= read -r line; do
    [[ "$line" =~ ^[^#=]*= ]] && export "$line" 2>/dev/null || true
done < "$DEPLOY_DIR/.env"

# .env может содержать прокси-переменные — убираем, они блокируют S3/Docker Hub
unset HTTPS_PROXY HTTP_PROXY https_proxy http_proxy NO_PROXY no_proxy

for var in S3_BUCKET MOODLE_DB_PASSWORD AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY; do
    [[ -z "${!var:-}" ]] && fail "В .env не задана переменная: $var"
done
log "Обязательные переменные .env — OK"

# ── 7. Restore ────────────────────────────────────────────────────────────────
if [[ "$SKIP_RESTORE" == "true" ]]; then
    log "--skip-restore: пропускаем восстановление. Окружение готово."
    echo ""
    log "Чтобы восстановить вручную:"
    log "  cd $DEPLOY_DIR && bash scripts/restore.sh"
    exit 0
fi

step "7. Восстановление из S3"

RESTORE_FLAGS=""
[[ "$DRY_RUN" == "true" ]] && RESTORE_FLAGS="--dry-run"

export COMPOSE_DIR="$DEPLOY_DIR"
export MOODLE_URL="http://$(hostname -I | awk '{print $1}'):8080"

# sg docker — запускает в контексте группы docker без re-login
sg docker -c "bash $DEPLOY_DIR/scripts/restore.sh $RESTORE_FLAGS"

# ── 8. Финал ──────────────────────────────────────────────────────────────────
echo ""
log "════════════════════════════════════════"
log "Bootstrap завершён успешно!"
log "Moodle: http://$(hostname -I | awk '{print $1}'):8080"
log "API:    http://$(hostname -I | awk '{print $1}'):8000"
log ""
warn "Если это production — не забудь:"
warn "  1. Настроить nginx + SSL (Let's Encrypt)"
warn "  2. Обновить DNS на новый IP"
warn "  3. Проверить MOODLE_WWWROOT в .env (должен совпадать с реальным URL)"
log "════════════════════════════════════════"
