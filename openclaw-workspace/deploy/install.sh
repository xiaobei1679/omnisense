#!/bin/bash
# AI Agent Workspace 部署脚本 (macOS/Linux)
# 用法: ./deploy/install.sh

set -e
HOME_DIR="$HOME"
QCLAW_DIR="$HOME_DIR/.qclaw"
WORKSPACE_DIR="$QCLAW_DIR/workspace"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

echo "=== AI Agent Workspace 部署 ==="

# 1. 检查 OpenClaw
echo "[1/6] 检查 OpenClaw..."
if ! command -v openclaw &> /dev/null; then
    echo "  OpenClaw 未安装，请先安装：https://docs.openclaw.ai"
    exit 1
fi
echo "  OpenClaw 已安装"

# 2. 备份
echo "[2/6] 备份现有配置..."
if [ -d "$WORKSPACE_DIR" ]; then
    BACKUP_DIR="$QCLAW_DIR/backup_$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$BACKUP_DIR"
    cp -r "$WORKSPACE_DIR" "$BACKUP_DIR/"
    echo "  已备份到: $BACKUP_DIR"
else
    echo "  无现有workspace，跳过备份"
fi

# 3. 复制 workspace
echo "[3/6] 复制 workspace..."
mkdir -p "$WORKSPACE_DIR"
cp -r "$REPO_ROOT/workspace/"* "$WORKSPACE_DIR/"
echo "  workspace 已复制"

# 4. 配置
echo "[4/6] 复制配置..."
if [ -f "$REPO_ROOT/config/openclaw.json" ]; then
    # 备份已有配置，避免覆盖丢失用户手工修改（如 API key）
    if [ -f "$QCLAW_DIR/openclaw.json" ]; then
        mkdir -p "$BACKUP_DIR"
        cp "$QCLAW_DIR/openclaw.json" "$BACKUP_DIR/openclaw.json"
        echo "  已备份旧 openclaw.json 到 $BACKUP_DIR"
    fi
    cp "$REPO_ROOT/config/openclaw.json" "$QCLAW_DIR/openclaw.json"
    echo "  openclaw.json 已复制"
    echo "  ⚠ 请编辑 openclaw.json 中的 API key/model pool"
fi

# 5. gbrain
echo "[5/6] 复制 gbrain..."
if [ -d "$REPO_ROOT/gbrain" ]; then
    mkdir -p "$HOME_DIR/gbrain"
    cp -r "$REPO_ROOT/gbrain/"* "$HOME_DIR/gbrain/"
    echo "  gbrain 已复制"
fi

# 6. 复制小说产出
echo "[6/6] 复制小说产出..."
if [ -d "$REPO_ROOT/novel" ]; then
    PROJECT_DIR="${QCLAW_PROJECT_DIR:-$HOME_DIR/Desktop/项目产出}"
    mkdir -p "$PROJECT_DIR"
    cp -r "$REPO_ROOT/novel/"* "$PROJECT_DIR/"
    echo "  小说产出已复制到: $PROJECT_DIR"
fi

echo ""
echo "=== 部署完成 ==="
echo "下一步："
echo "  1. 编辑 ~/.qclaw/openclaw.json 中的 API key"
echo "  2. 设置 OPENAI_API_KEY 环境变量"
echo "  3. 运行: openclaw restart"
