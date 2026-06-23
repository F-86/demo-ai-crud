#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# demo-ai-crud 控制脚本
# 用法：
#   ./start.sh start              同时启动前端和后端
#   ./start.sh start backend      仅启动后端
#   ./start.sh start frontend     仅启动前端
#   ./start.sh stop               同时关闭前端和后端
#   ./start.sh stop backend       仅关闭后端
#   ./start.sh stop frontend      仅关闭前端
#   ./start.sh restart [target]   重启（默认 all）
#   ./start.sh status             查看前后端运行状态
#   ./start.sh log backend        实时跟踪后端日志
#   ./start.sh log frontend       实时跟踪前端日志
# ─────────────────────────────────────────────────────────────

set -euo pipefail

# ── 路径配置 ──────────────────────────────────────────────────
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${ROOT}/backend"
FRONTEND_DIR="${ROOT}/frontend"
LOG_DIR="${ROOT}/logs"
PID_DIR="${ROOT}/pids"

BACKEND_LOG="${LOG_DIR}/backend.log"
FRONTEND_LOG="${LOG_DIR}/frontend.log"
BACKEND_PID="${PID_DIR}/backend.pid"
FRONTEND_PID="${PID_DIR}/frontend.pid"

# ── 服务配置 ──────────────────────────────────────────────────
BACKEND_HOST="${BACKEND_HOST:-0.0.0.0}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-33177}"

# ── 颜色输出 ──────────────────────────────────────────────────
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
CYAN="\033[0;36m"
RESET="\033[0m"

info()    { echo -e "${GREEN}[INFO]${RESET}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
error()   { echo -e "${RED}[ERROR]${RESET} $*"; }
section() { echo -e "${CYAN}$*${RESET}"; }

# ── 工具函数 ──────────────────────────────────────────────────

_read_pid() {
    local file="$1"
    [[ -f "${file}" ]] && cat "${file}" || echo ""
}

_is_running() {
    local pid="$1"
    [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null
}

_wait_start() {
    local pid="$1" label="$2"
    local waited=0
    while ! _is_running "${pid}"; do
        sleep 0.5
        waited=$((waited + 1))
        if [[ ${waited} -ge 10 ]]; then
            error "${label} 启动失败，请检查日志"
            return 1
        fi
    done
}

_wait_stop() {
    local pid="$1" label="$2"
    local waited=0
    while _is_running "${pid}"; do
        sleep 0.5
        waited=$((waited + 1))
        if [[ ${waited} -ge 20 ]]; then
            warn "${label} 未响应 SIGTERM，强制终止..."
            kill -9 "${pid}" 2>/dev/null || true
            break
        fi
    done
}

# ── 后端 ──────────────────────────────────────────────────────

start_backend() {
    local pid
    pid="$(_read_pid "${BACKEND_PID}")"
    if _is_running "${pid}"; then
        warn "后端已在运行 (PID: ${pid})"
        return 0
    fi

    mkdir -p "${LOG_DIR}" "${PID_DIR}"

    [[ -f "${BACKEND_DIR}/.env" ]] || warn ".env 不存在，请先复制 backend/.env.example 并填写配置"

    section "► 启动后端 (${BACKEND_HOST}:${BACKEND_PORT})..."
    nohup uv run --project "${BACKEND_DIR}" --directory "${BACKEND_DIR}" \
        uvicorn main:app --host "${BACKEND_HOST}" --port "${BACKEND_PORT}" \
        >> "${BACKEND_LOG}" 2>&1 &
    local new_pid=$!
    echo "${new_pid}" > "${BACKEND_PID}"

    _wait_start "${new_pid}" "后端" || { rm -f "${BACKEND_PID}"; return 1; }

    info "后端已启动"
    info "  PID    : ${new_pid}"
    info "  地址   : http://localhost:${BACKEND_PORT}"
    info "  文档   : http://localhost:${BACKEND_PORT}/docs"
    info "  日志   : ${BACKEND_LOG}"
}

stop_backend() {
    local pid
    pid="$(_read_pid "${BACKEND_PID}")"
    if ! _is_running "${pid}"; then
        warn "后端未在运行"
        rm -f "${BACKEND_PID}"
        return 0
    fi
    section "► 停止后端 (PID: ${pid})..."
    kill "${pid}"
    _wait_stop "${pid}" "后端"
    rm -f "${BACKEND_PID}"
    info "后端已停止"
}

# ── 前端 ──────────────────────────────────────────────────────

start_frontend() {
    local pid
    pid="$(_read_pid "${FRONTEND_PID}")"
    if _is_running "${pid}"; then
        warn "前端已在运行 (PID: ${pid})"
        return 0
    fi

    mkdir -p "${LOG_DIR}" "${PID_DIR}"

    section "► 启动前端 (localhost:${FRONTEND_PORT})..."
    nohup env BROWSER=none DANGEROUSLY_DISABLE_HOST_CHECK=true PORT="${FRONTEND_PORT}" \
        npm start --prefix "${FRONTEND_DIR}" \
        >> "${FRONTEND_LOG}" 2>&1 &
    local new_pid=$!
    echo "${new_pid}" > "${FRONTEND_PID}"

    _wait_start "${new_pid}" "前端" || { rm -f "${FRONTEND_PID}"; return 1; }

    info "前端已启动"
    info "  PID    : ${new_pid}"
    info "  地址   : http://localhost:${FRONTEND_PORT}"
    info "  日志   : ${FRONTEND_LOG}"
}

stop_frontend() {
    local pid
    pid="$(_read_pid "${FRONTEND_PID}")"
    if ! _is_running "${pid}"; then
        warn "前端未在运行"
        rm -f "${FRONTEND_PID}"
        return 0
    fi
    section "► 停止前端 (PID: ${pid})..."
    kill "${pid}"
    _wait_stop "${pid}" "前端"
    rm -f "${FRONTEND_PID}"
    info "前端已停止"
}

# ── 子命令 ────────────────────────────────────────────────────

cmd_start() {
    case "${1:-all}" in
        all|"")    start_backend; start_frontend ;;
        backend)   start_backend  ;;
        frontend)  start_frontend ;;
        *) error "未知目标: $1（可选 all / backend / frontend）"; exit 1 ;;
    esac
}

cmd_stop() {
    case "${1:-all}" in
        all|"")    stop_backend; stop_frontend ;;
        backend)   stop_backend  ;;
        frontend)  stop_frontend ;;
        *) error "未知目标: $1（可选 all / backend / frontend）"; exit 1 ;;
    esac
}

cmd_restart() {
    local target="${1:-all}"
    section "► 重启 ${target}..."
    cmd_stop "${target}"
    sleep 1
    cmd_start "${target}"
}

cmd_status() {
    local b_pid f_pid
    b_pid="$(_read_pid "${BACKEND_PID}")"
    f_pid="$(_read_pid "${FRONTEND_PID}")"

    section "─── demo-ai-crud 状态 ──────────────────────────"

    # 后端
    if _is_running "${b_pid}"; then
        local b_start
        b_start="$(ps -o lstart= -p "${b_pid}" 2>/dev/null | xargs || echo '未知')"
        info "后端  : 运行中 ✓  PID=${b_pid}  启动=${b_start}"
        info "        http://localhost:${BACKEND_PORT}  |  docs: /docs"
        if command -v curl &>/dev/null; then
            local http
            http="$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 2 \
                "http://localhost:${BACKEND_PORT}/api/skills" 2>/dev/null || echo '—')"
            [[ "${http}" == "200" ]] \
                && info "        健康检查 HTTP ${http} ✓" \
                || warn "        健康检查 HTTP ${http}"
        fi
    else
        error "后端  : 未运行 ✗"
        rm -f "${BACKEND_PID}"
    fi

    echo ""

    # 前端
    if _is_running "${f_pid}"; then
        local f_start
        f_start="$(ps -o lstart= -p "${f_pid}" 2>/dev/null | xargs || echo '未知')"
        info "前端  : 运行中 ✓  PID=${f_pid}  启动=${f_start}"
        info "        http://localhost:${FRONTEND_PORT}"
    else
        error "前端  : 未运行 ✗"
        rm -f "${FRONTEND_PID}"
    fi

    section "────────────────────────────────────────────────"
}

cmd_log() {
    case "${1:-}" in
        backend)
            [[ -f "${BACKEND_LOG}" ]] || { warn "后端日志不存在，请先启动后端"; exit 1; }
            section "► 后端日志 (Ctrl+C 退出)..."
            tail -f "${BACKEND_LOG}"
            ;;
        frontend)
            [[ -f "${FRONTEND_LOG}" ]] || { warn "前端日志不存在，请先启动前端"; exit 1; }
            section "► 前端日志 (Ctrl+C 退出)..."
            tail -f "${FRONTEND_LOG}"
            ;;
        *)
            error "请指定目标: ./server.sh log backend  或  ./server.sh log frontend"
            exit 1
            ;;
    esac
}

cmd_help() {
    echo -e "
${CYAN}demo-ai-crud 控制脚本${RESET}

用法：
  ./server.sh <命令> [目标]

命令：
  start   [all|backend|frontend]   后台启动（默认 all）
  stop    [all|backend|frontend]   停止服务（默认 all）
  restart [all|backend|frontend]   重启服务（默认 all）
  status                           查看前后端运行状态
  log     <backend|frontend>       实时跟踪指定日志
  help                             显示此帮助

环境变量：
  BACKEND_PORT   后端端口（默认 8000）
  FRONTEND_PORT  前端端口（默认 33177）
  BACKEND_HOST   后端监听地址（默认 0.0.0.0）

示例：
  ./server.sh start
  ./server.sh start backend
  ./server.sh stop frontend
  ./server.sh status
  ./server.sh log backend
  BACKEND_PORT=9000 ./server.sh start backend
"
}

# ── 入口 ──────────────────────────────────────────────────────
case "${1:-help}" in
    start)           cmd_start   "${2:-all}" ;;
    stop)            cmd_stop    "${2:-all}" ;;
    restart)         cmd_restart "${2:-all}" ;;
    status)          cmd_status  ;;
    log)             cmd_log     "${2:-}"    ;;
    help|--help|-h)  cmd_help    ;;
    *)
        error "未知命令: $1"
        cmd_help
        exit 1
        ;;
esac
