# AI Agent Workspace 部署脚本 (Windows)
# 用法: ./deploy/install.ps1

$ErrorActionPreference = "Stop"
$HOME_DIR = $env:USERPROFILE
$QCLAW_DIR = Join-Path $HOME_DIR ".qclaw"
$WORKSPACE_DIR = Join-Path $QCLAW_DIR "workspace"
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$REPO_ROOT = Split-Path -Parent $SCRIPT_DIR

Write-Host "=== AI Agent Workspace 部署 ===" -ForegroundColor Cyan

# 1. 检查 OpenClaw
Write-Host "[1/6] 检查 OpenClaw..." -ForegroundColor Yellow
$ocPath = Get-Command openclaw -ErrorAction SilentlyContinue
if (-not $ocPath) {
    Write-Host "  OpenClaw 未安装，请先安装：https://docs.openclaw.ai" -ForegroundColor Red
    exit 1
}
Write-Host "  OpenClaw 已安装" -ForegroundColor Green

# 2. 备份现有配置
Write-Host "[2/6] 备份现有配置..." -ForegroundColor Yellow
$backupDir = Join-Path $QCLAW_DIR "backup_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
if (Test-Path $WORKSPACE_DIR) {
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    Copy-Item $WORKSPACE_DIR $backupDir -Recurse -Force
    Write-Host "  已备份到: $backupDir" -ForegroundColor Green
} else {
    Write-Host "  无现有workspace，跳过备份" -ForegroundColor Gray
}

# 3. 复制 workspace
Write-Host "[3/6] 复制 workspace..." -ForegroundColor Yellow
New-Item -ItemType Directory -Path $WORKSPACE_DIR -Force | Out-Null
Copy-Item (Join-Path $REPO_ROOT "workspace\*") $WORKSPACE_DIR -Recurse -Force
Write-Host "  workspace 已复制" -ForegroundColor Green

# 3.1 确保标准子目录存在（部分目录被 .gitignore 排除，clone 后可能缺失）
@("memory", "dashboard", "团队配置", "skills") | ForEach-Object {
    $d = Join-Path $WORKSPACE_DIR $_
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}
Write-Host "  已确保标准子目录 memory/dashboard/团队配置/skills 存在" -ForegroundColor Gray

# 4. 复制配置
Write-Host "[4/6] 复制配置..." -ForegroundColor Yellow
$configSrc = Join-Path $REPO_ROOT "config\openclaw.json"
$configDst = Join-Path $QCLAW_DIR "openclaw.json"
if (Test-Path $configSrc) {
    # 备份已有配置，避免覆盖丢失用户手工修改（如 API key）
    if (Test-Path $configDst) {
        if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir -Force | Out-Null }
        Copy-Item $configDst (Join-Path $backupDir "openclaw.json") -Force
        Write-Host "  已备份旧 openclaw.json 到 $backupDir" -ForegroundColor Gray
    }
    Copy-Item $configSrc $configDst -Force
    Write-Host "  openclaw.json 已复制" -ForegroundColor Green
    Write-Host "  ⚠ 请编辑 openclaw.json 中的 API key/model pool" -ForegroundColor Red
}

# 5. 复制 gbrain（知识库；clone 后可能为空目录，确保目标存在）
Write-Host "[5/6] 复制 gbrain..." -ForegroundColor Yellow
$gbrainSrc = Join-Path $REPO_ROOT "gbrain"
$gbrainDst = Join-Path $HOME_DIR "gbrain"
if (-not (Test-Path $gbrainDst)) { New-Item -ItemType Directory -Path $gbrainDst -Force | Out-Null }
if (Test-Path $gbrainSrc) {
    Copy-Item (Join-Path $gbrainSrc "*") $gbrainDst -Recurse -Force
    Write-Host "  gbrain 已复制" -ForegroundColor Green
} else {
    Write-Host "  仓库未含 gbrain（已被 .gitignore 排除），已创建空目录，由你本地初始化" -ForegroundColor Gray
}

# 6. 复制小说产出（仓库未含时仅确保目标目录存在）
Write-Host "[6/6] 复制小说产出..." -ForegroundColor Yellow
$novelSrc = Join-Path $REPO_ROOT "novel"
$novelDst = if ($env:QCLAW_PROJECT_DIR) { $env:QCLAW_PROJECT_DIR } else { Join-Path $HOME_DIR "Desktop" "项目产出" }
if (-not (Test-Path $novelDst)) { New-Item -ItemType Directory -Path $novelDst -Force | Out-Null }
if (Test-Path $novelSrc) {
    Copy-Item (Join-Path $novelSrc "*") $novelDst -Recurse -Force
    Write-Host "  小说产出已复制到: $novelDst" -ForegroundColor Green
} else {
    Write-Host "  仓库未含 novel（已被 .gitignore 排除），已创建空目录: $novelDst" -ForegroundColor Gray
}

Write-Host ""
Write-Host "=== 部署完成 ===" -ForegroundColor Cyan
Write-Host "下一步：" -ForegroundColor White
Write-Host "  1. 编辑 ~/.qclaw/openclaw.json 中的 API key"
Write-Host "  2. 设置 OPENAI_API_KEY 环境变量（gbrain embedding，可选）"
Write-Host "  3. 运行: openclaw restart"
Write-Host "  4. 验证: ./deploy/verify.ps1"
