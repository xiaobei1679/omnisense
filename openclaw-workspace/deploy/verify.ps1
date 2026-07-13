# AI Agent Workspace 部署验证脚本
$ErrorActionPreference = "Continue"
$pass = 0; $fail = 0

function Check($name, $condition) {
    if ($condition) { Write-Host "  ✅ $name" -ForegroundColor Green; $pass++ }
    else { Write-Host "  ❌ $name" -ForegroundColor Red; $fail++ }
}

function Warn($name, $condition) {
    if ($condition) { Write-Host "  ✅ $name" -ForegroundColor Green; $pass++ }
    else { Write-Host "  ⚠️  $name（可选，未配置不影响框架运行）" -ForegroundColor Yellow }
}

Write-Host "=== AI Agent Workspace 部署验证 ===" -ForegroundColor Cyan

$WS = "$env:USERPROFILE\.qclaw\workspace"
Check "AGENTS.md" (Test-Path "$WS\AGENTS.md")
Check "SOUL.md" (Test-Path "$WS\SOUL.md")
Check "MEMORY.md" (Test-Path "$WS\MEMORY.md")
Check "HEARTBEAT.md" (Test-Path "$WS\HEARTBEAT.md")
Check ".learnings/" (Test-Path "$WS\.learnings")
Check "memory/" (Test-Path "$WS\memory")
Check "dashboard/" (Test-Path "$WS\dashboard")
Check "团队配置/" (Test-Path "$WS\团队配置")
Check "skills/" (Test-Path "$WS\skills")
Check "openclaw.json" (Test-Path "$env:USERPROFILE\.qclaw\openclaw.json")
Warn "gbrain/（可选）" (Test-Path "$env:USERPROFILE\gbrain")
$novelDir = if ($env:QCLAW_PROJECT_DIR) { $env:QCLAW_PROJECT_DIR } else { Join-Path $env:USERPROFILE "Desktop" "项目产出" }
Warn "小说产出（可选）" (Test-Path $novelDir)

Write-Host ""
Write-Host "结果: $pass 通过, $fail 失败" -ForegroundColor $(if($fail -eq 0){'Green'}else{'Yellow'})
if ($fail -gt 0) { Write-Host "请检查失败项" -ForegroundColor Yellow }

# 退出码：失败数>0 时返回 1，供 CI/调用方判断部署成败
if ($fail -gt 0) { exit 1 } else { exit 0 }
