"""
下载 MOSS-TTS-Nano 模型权重到本地 models/ 目录。

默认使用 hf-mirror.com（国内可直接访问），可通过 HF_ENDPOINT 环境变量覆盖。
进度以文件级别输出，便于嵌入到 Electron UI 日志中。
"""

import os
import sys
from pathlib import Path

# ── 国内镜像：在 import huggingface_hub 之前设置 ──
if "HF_ENDPOINT" not in os.environ:
    os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"

from huggingface_hub import HfApi, hf_hub_download  # noqa: E402

MODELS_DIR = Path(__file__).parent / "models"

REPOS = [
    ("OpenMOSS-Team/MOSS-TTS-Nano", "tts-nano"),
    ("OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano", "audio-tokenizer-nano"),
]


def download_repo(repo_id: str, subdir: str) -> None:
    local_dir = MODELS_DIR / subdir
    local_dir.mkdir(parents=True, exist_ok=True)

    api = HfApi()
    info = api.model_info(repo_id)
    files = [f for f in info.siblings if f.rfilename not in (".gitattributes",)]
    total = len(files)

    print(f"[下载] {repo_id} → {local_dir}  ({total} 个文件)", flush=True)

    for i, file_info in enumerate(files, 1):
        name = file_info.rfilename
        size = file_info.size or 0
        if size > 1_000_000:
            size_str = f"{size / 1_000_000:.1f}MB"
        elif size > 1_000:
            size_str = f"{size / 1_000:.0f}KB"
        else:
            size_str = f"{size}B"

        # 检查是否已下载
        local_path = local_dir / name
        if local_path.exists() and local_path.stat().st_size == size and size > 0:
            print(f"  [{i}/{total}] {name} ({size_str}) ✓ 已存在", flush=True)
            continue

        print(f"  [{i}/{total}] {name} ({size_str}) 下载中…", flush=True)
        hf_hub_download(
            repo_id,
            name,
            local_dir=str(local_dir),
        )

    print(f"[完成] {repo_id}", flush=True)


def main() -> None:
    MODELS_DIR.mkdir(exist_ok=True)
    for repo_id, subdir in REPOS:
        try:
            download_repo(repo_id, subdir)
        except Exception as e:
            print(f"[失败] {repo_id}: {e}", flush=True, file=sys.stderr)
            sys.exit(1)

    print("[全部完成] 模型权重已就绪", flush=True)


if __name__ == "__main__":
    main()
