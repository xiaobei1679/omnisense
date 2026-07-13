"""progress_tracker.py - 任务进度追踪与恢复"""
import json
import os
import glob
import argparse
from datetime import datetime, timezone, timedelta

CST = timezone(timedelta(hours=8))
TASKS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".qclaw", "tasks")

def list_tasks(status_filter: str = "all") -> list:
    """列出所有任务"""
    tasks = []
    pattern = os.path.join(TASKS_DIR, "**", "manifest.json")
    
    for path in glob.glob(pattern, recursive=True):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                task = json.load(f)
            task["_filepath"] = path
            
            if status_filter == "all" or task.get("status") == status_filter:
                tasks.append({
                    "task_id": task["task_id"],
                    "description": task.get("original_request", "")[:80],
                    "status": task.get("status", "unknown"),
                    "progress": f"{task['metadata']['completed_count']}/{task['metadata']['total_subtasks']}",
                    "last_updated": task.get("updated_at", ""),
                    "_filepath": path
                })
        except (json.JSONDecodeError, KeyError, IOError):
            continue
    
    return sorted(tasks, key=lambda t: t["last_updated"], reverse=True)

def load_task(task_id: str) -> dict:
    """加载指定任务的完整清单"""
    # 精确匹配
    for path in glob.glob(os.path.join(TASKS_DIR, "**", "manifest.json"), recursive=True):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                task = json.load(f)
            if task.get("task_id") == task_id:
                task["_filepath"] = path
                return task
        except (json.JSONDecodeError, IOError):
            continue
    
    # 模糊匹配
    for path in glob.glob(os.path.join(TASKS_DIR, "**", "manifest.json"), recursive=True):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                task = json.load(f)
            if task.get("task_id", "").startswith(task_id):
                task["_filepath"] = path
                return task
        except (json.JSONDecodeError, IOError):
            continue
    
    return None

def update_task(task_id: str, subtask_id: str = None, status: str = None) -> dict:
    """更新任务或子任务状态"""
    task = load_task(task_id)
    if not task:
        return {"error": f"任务 {task_id} 未找到"}
    
    filepath = task.pop("_filepath", None)
    
    if subtask_id and status:
        for st in task["subtasks"]:
            if st["id"] == subtask_id:
                st["status"] = status
                break
    
    # 重新计算统计
    completed = sum(1 for st in task["subtasks"] if st["status"] == "completed")
    failed = sum(1 for st in task["subtasks"] if st["status"] == "failed")
    in_progress = sum(1 for st in task["subtasks"] if st["status"] == "in_progress")
    
    task["metadata"]["completed_count"] = completed
    task["metadata"]["failed_count"] = failed
    task["updated_at"] = datetime.now(CST).isoformat()
    
    if completed == len(task["subtasks"]):
        task["status"] = "completed"
    elif failed > 0 and completed + failed == len(task["subtasks"]):
        task["status"] = "failed"
    elif in_progress > 0 or completed > 0:
        task["status"] = "in_progress"
    
    if filepath:
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(task, f, ensure_ascii=False, indent=2)
    
    return task

def archive_task(task_id: str) -> dict:
    """归档已完成任务"""
    task = load_task(task_id)
    if not task:
        return {"error": f"任务 {task_id} 未找到"}
    
    filepath = task.pop("_filepath", None)
    
    archive_dir = os.path.join(TASKS_DIR, "archived")
    os.makedirs(archive_dir, exist_ok=True)
    
    archive_path = os.path.join(archive_dir, f"{task_id}.json")
    
    task["status"] = "archived"
    task["archived_at"] = datetime.now(CST).isoformat()
    
    with open(archive_path, 'w', encoding='utf-8') as f:
        json.dump(task, f, ensure_ascii=False, indent=2)
    
    # 删除原始文件
    if filepath and os.path.exists(filepath):
        os.remove(filepath)
    
    return {"archived": task_id, "path": archive_path}

def main():
    parser = argparse.ArgumentParser(description="任务进度追踪器")
    parser.add_argument("--list", action="store_true", help="列出所有任务")
    parser.add_argument("--status", default="all", 
                        choices=["all", "in_progress", "completed", "failed", "pending"],
                        help="按状态筛选")
    parser.add_argument("--load", type=str, help="加载指定任务")
    parser.add_argument("--update", type=str, help="更新任务（task_id）")
    parser.add_argument("--subtask", type=str, help="子任务ID")
    parser.add_argument("--new-status", type=str, 
                        choices=["pending", "in_progress", "completed", "failed"],
                        help="新状态")
    parser.add_argument("--archive", type=str, help="归档任务（task_id）")
    args = parser.parse_args()
    
    if args.list:
        tasks = list_tasks(args.status)
        print(json.dumps(tasks, ensure_ascii=False, indent=2))
    
    elif args.archive:
        result = archive_task(args.archive)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    
    elif args.load:
        task = load_task(args.load)
        if task:
            filepath = task.pop("_filepath", None)
            print(json.dumps(task, ensure_ascii=False, indent=2))
        else:
            print(json.dumps({"error": "未找到"}, ensure_ascii=False))
    
    elif args.update and args.subtask and args.new_status:
        result = update_task(args.update, args.subtask, args.new_status)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
