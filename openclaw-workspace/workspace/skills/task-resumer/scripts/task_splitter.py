"""task_splitter.py - 任务拆分器：生成子任务清单"""
import json
import os
import uuid
import argparse
from datetime import datetime, timezone, timedelta

CST = timezone(timedelta(hours=8))

def split_task(task_desc: str, strategy: str = "auto", output_path: str = None) -> dict:
    """将大任务拆分为子任务清单"""
    
    # 基于策略生成子任务
    subtasks = _generate_subtasks(task_desc, strategy)
    
    task_id = f"task_{datetime.now(CST).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
    
    manifest = {
        "task_id": task_id,
        "created_at": datetime.now(CST).isoformat(),
        "updated_at": datetime.now(CST).isoformat(),
        "original_request": task_desc,
        "status": "pending",
        "subtasks": subtasks,
        "current_index": 0,
        "metadata": {
            "total_subtasks": len(subtasks),
            "completed_count": 0,
            "failed_count": 0,
            "strategy": strategy
        }
    }
    
    if output_path:
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
    
    return manifest

def _generate_subtasks(task_desc: str, strategy: str) -> list:
    """根据策略生成子任务列表"""
    subtasks = []
    idx = 1
    
    # 策略：by_phase - 按阶段拆分
    if strategy in ("by_phase", "auto"):
        phases = _detect_phases(task_desc)
        for phase in phases:
            subtasks.append({
                "id": f"st-{idx:03d}",
                "description": phase,
                "status": "pending",
                "dependencies": [f"st-{idx-1:03d}"] if idx > 1 else [],
                "output": "",
                "session_key": ""
            })
            idx += 1
    
    # 策略：by_file - 按文件/模块拆分
    elif strategy == "by_file":
        # 默认拆分为 3-5 个文件级子任务
        file_count = min(5, max(3, task_desc.count("文件") + 1))
        for i in range(file_count):
            subtasks.append({
                "id": f"st-{idx:03d}",
                "description": f"处理第 {i+1} 部分：{task_desc[:40]}...",
                "status": "pending",
                "dependencies": [],
                "output": "",
                "session_key": ""
            })
            idx += 1
    
    # 默认至少生成一个子任务
    if not subtasks:
        subtasks.append({
            "id": "st-001",
            "description": f"执行：{task_desc[:80]}",
            "status": "pending",
            "dependencies": [],
            "output": "",
            "session_key": ""
        })
    
    return subtasks

def _detect_phases(task_desc: str) -> list:
    """检测任务中的阶段"""
    phases = []
    phase_patterns = [
        ("分析", ["分析", "调研", "研究", "了解", "查看"]),
        ("设计", ["设计", "规划", "架构", "方案"]),
        ("实现", ["实现", "编写", "开发", "创建", "生成", "构建"]),
        ("审查", ["审查", "检查", "审核", "验证", "测试"]),
        ("整理", ["整理", "汇总", "总结", "归档", "输出"]),
    ]
    
    for phase_name, keywords in phase_patterns:
        if any(kw in task_desc for kw in keywords):
            phases.append(f"[{phase_name}] {task_desc[:60]}")
    
    # 如果没检测到明确阶段，至少保证分析+实现
    if not phases:
        phases = [
            f"[分析] 分析需求：{task_desc[:50]}",
            f"[实现] 执行任务：{task_desc[:50]}",
        ]
    
    # 始终保证有审查/验证阶段
    if not any("审查" in p or "验证" in p or "检查" in p for p in phases):
        phases.append(f"[审查] 验证结果：{task_desc[:50]}")
    
    return phases

def main():
    parser = argparse.ArgumentParser(description="任务拆分器")
    parser.add_argument("--task", required=True, help="任务描述")
    parser.add_argument("--output", default=None, help="输出 manifest.json 路径")
    parser.add_argument("--strategy", default="auto", 
                        choices=["auto", "by_file", "by_phase", "by_module"],
                        help="拆分策略")
    args = parser.parse_args()
    
    manifest = split_task(args.task, args.strategy, args.output)
    print(json.dumps(manifest, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
