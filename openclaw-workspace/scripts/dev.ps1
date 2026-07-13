# openclaw-workspace dev helper (Windows PowerShell 5.1+).
# Usage: .\scripts\dev.ps1 <command>
# PowerShell 5.1 compatible: no ternary operator; ASCII-only to avoid encoding issues.
$ErrorActionPreference = 'Stop'
$Node = if ($env:NODE) { $env:NODE } else { 'node' }
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $Root

switch ($args[0]) {
  'check' {
    & $Node scripts/ci/check-syntax.mjs
  }
  'test' {
    $files = Get-ChildItem -Path tests -Filter *.test.mjs -Recurse
    if ($files.Count -eq 0) { Write-Host 'no tests found'; exit 0 }
    & $Node --test $files.FullName
  }
  'validate' {
    & $Node scripts/ci/validate-config.mjs
  }
  'healthcheck' {
    & $Node scripts/ci/check-syntax.mjs
    & $Node scripts/ci/validate-config.mjs
    $files = Get-ChildItem -Path tests -Filter *.test.mjs -Recurse
    if ($files.Count -eq 0) { Write-Host 'no tests found'; exit 0 }
    & $Node --test $files.FullName
  }
  'run-agent' {
    $env:AGENT_LOCAL = '1'
    if (-not $env:AGENT_TASK_FILE) {
      $env:AGENT_TASK_FILE = 'scripts/agent/task.example.md'
    }
    if (-not $env:LLM_PROVIDER) {
      $env:LLM_PROVIDER = 'ollama'
    }
    & $Node scripts/agent/respond.mjs
  }
  'llm-adapter' {
    & $Node scripts/llm/adapter.mjs $args[1] $args[2] $args[3]
  }
  'install' {
    if (-not (Test-Path '.env')) {
      Copy-Item .env.example .env
    }
    & ./deploy/install.sh
  }
  'dashboard' {
    & $Node scripts/dashboard.mjs
  }
  'install-hooks' {
    bash scripts/install-hooks.sh
  }
  'observer' {
    & $Node scripts/ci/observer.mjs --diff
  }
  'router' {
    & $Node scripts/agent/router.mjs $args[1] $args[2] $args[3] $args[4]
  }
  'reviewer' {
    & $Node scripts/ci/reviewer.mjs $args[1] $args[2] $args[3]
  }
  'roles' {
    & $Node scripts/agent/roles.mjs $args[1]
  }
  'evolve' {
    & $Node scripts/evolve/ingest.mjs $args[1] $args[2] $args[3]
  }
  'release-notes' {
    & $Node scripts/release/notes.mjs $args[1] $args[2] $args[3] $args[4] $args[5]
  }
  'doctor' {
    & $Node scripts/doctor.mjs
  }
  'permissions' {
    & $Node scripts/security/permissions.mjs $args[1] $args[2] $args[3]
  }
  'skills' {
    $skillsDir = if ($args[1]) { $args[1] } else { 'examples' }
    & $Node scripts/skills/registry.mjs --list $skillsDir
  }
  'cost' {
    & $Node scripts/llm/cost.mjs $args[1] $args[2] $args[3] $args[4] $args[5] $args[6]
  }
  'llm-cache' {
    & $Node scripts/llm/cache.mjs $args[1] $args[2] $args[3] $args[4] $args[5] $args[6]
  }
  'circuit-breaker' {
    & $Node scripts/llm/circuit-breaker.mjs $args[1] $args[2] $args[3]
  }
  default {
    Write-Host 'Usage: dev.ps1 {check|test|validate|healthcheck|run-agent|install|dashboard|llm-adapter|install-hooks|observer|router|reviewer|roles|evolve|release-notes|doctor|permissions|skills|cost|llm-cache|circuit-breaker}'
    exit 1
  }
}
