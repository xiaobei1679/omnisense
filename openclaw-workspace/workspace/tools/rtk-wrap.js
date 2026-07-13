#!/usr/bin/env node
// rtk-wrap.js — 透明 RTK 过滤器
// 把任意 exec 命令自动路由到 RTK 压缩输出
// 用法: node rtk-wrap.js <command> [args...]

const { execSync } = require("child_process");
const path = require("path");

const RTK = path.join(process.env.USERPROFILE, ".cargo", "bin", "rtk.exe");

const RTK_COMMANDS = new Set([
  "git", "npm", "npx", "cargo", "docker", "kubectl", "ls", "dir",
  "tree", "grep", "rg", "find", "diff", "curl", "pip", "go", "pytest",
  "tsc", "jest", "vitest", "eslint", "prettier", "ruff", "mypy", "dotnet",
  "gh", "psql", "pnpm", "next", "prisma", "playwright", "read", "log",
  "wget", "wc", "mvn", "gradlew", "golangci-lint", "rake", "rspec", "rubocop"
]);

const cmd = process.argv[2];
const args = process.argv.slice(3);

if (!cmd) {
  console.error("Usage: rtk-wrap.js <command> [args...]");
  process.exit(1);
}

try {
  if (RTK_COMMANDS.has(cmd)) {
    const result = execSync(`"${RTK}" ${cmd} ${args.join(" ")}`, {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
    process.stdout.write(result);
  } else {
    const result = execSync(`${cmd} ${args.join(" ")}`, {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
    process.stdout.write(result);
  }
} catch (e) {
  if (e.stdout) process.stdout.write(e.stdout);
  if (e.stderr) process.stderr.write(e.stderr);
  process.exit(e.status || 1);
}
