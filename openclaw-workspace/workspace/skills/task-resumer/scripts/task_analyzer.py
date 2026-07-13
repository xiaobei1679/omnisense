"""task_analyzer.py - 任务复杂度分析器"""
import json
import sys
import argparse

def analyze(task_desc: str, verbose: bool = False) -> dict:
    """分析任务复杂度，建议是否拆分"""
    score = 0
    reasons = []
    
    # 文件数量检测
    file_keywords = ["多文件", "多个文件", "所有", "全部", "批量", "每个", "各个"]
    if any(kw in task_desc for kw in file_keywords):
        score += 3
        reasons.append("涉及多文件操作")
    
    # 阶段检测
    phase_keywords = ["分析", "设计", "实现", "测试", "部署", "审查", "重构"]
    phase_count = sum(1 for kw in phase_keywords if kw in task_desc)
    if phase_count >= 2:
        score += 2
        reasons.append(f"多阶段任务（{phase_count}个阶段）")
    
    # 批量操作检测
    batch_keywords = ["批量", "重构", "重写", "迁移", "转换", "生成"]
    if any(kw in task_desc for kw in batch_keywords):
        score += 2
        reasons.append("批量操作类型")
    
    # 长度检测
    if len(task_desc) > 200:
        score += 1
        reasons.append("任务描述较长")
    
    # 复杂度关键词
    complex_kw = ["完整", "全面", "系统", "模块", "架构", "流水线"]
    if any(kw in task_desc for kw in complex_kw):
        score += 1
        reasons.append("涉及系统性变更")
    
    score = min(score, 10)
    should_split = score >= 4
    
    strategies = []
    if "文件" in task_desc or "所有" in task_desc:
        strategies.append("by_file")
    if phase_count >= 2:
        strategies.append("by_phase")
    
    strategy = strategies[0] if strategies else "auto"
    
    result = {
        "complexity_score": score,
        "should_split": should_split,
        "reason": "; ".join(reasons) if reasons else "任务复杂度低，无需拆分",
        "suggested_strategy": strategy,
        "estimated_subtasks": max(1, score)
    }
    
    if verbose:
        result["details"] = {
            "task_length": len(task_desc),
            "phase_count": phase_count,
            "matched_patterns": reasons
        }
    
    return result

def main():
    parser = argparse.ArgumentParser(description="任务复杂度分析器")
    parser.add_argument("--task", required=True, help="任务描述")
    parser.add_argument("--verbose", action="store_true", help="详细输出")
    args = parser.parse_args()
    
    result = analyze(args.task, args.verbose)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    sys.exit(0 if not result["should_split"] else 0)

if __name__ == "__main__":
    main()
