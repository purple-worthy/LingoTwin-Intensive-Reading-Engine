import os
import sys
import site
import time
from pathlib import Path

today = time.strftime('%Y-%m-%d')

# 收集所有可能的 site-packages 路径
candidate_paths = set()

# 1) site 模块提供的路径
try:
    candidate_paths.update(site.getsitepackages())
except Exception:
    pass
try:
    candidate_paths.add(site.getusersitepackages())
except Exception:
    pass

# 2) sys.path 中所有包含 site-packages / dist-packages 的目录
for p in sys.path:
    if p and ('site-packages' in p or 'dist-packages' in p):
        candidate_paths.add(p)

# 3) 当前解释器的纯 lib 路径（兜底）
candidate_paths.add(str(Path(sys.prefix) / 'Lib' / 'site-packages'))

found = {}

for sp in candidate_paths:
    sp_path = Path(sp)
    if not sp_path.exists():
        continue
    for item in sp_path.iterdir():
        try:
            if not item.is_dir():
                continue
            name = item.name

            # 优先看 .dist-info / .egg-info（pip 安装时创建，mtime 最接近安装时间）
            if name.endswith('.dist-info') or name.endswith('.egg-info'):
                pkg_name = name.split('-')[0]
                mtime = time.strftime('%Y-%m-%d', time.localtime(item.stat().st_mtime))
                if mtime == today:
                    found[pkg_name] = str(item)

            # 再看包目录本身（补充，有些包没有 dist-info）
            elif not name.startswith('_') and '.' not in name:
                mtime = time.strftime('%Y-%m-%d', time.localtime(item.stat().st_mtime))
                if mtime == today:
                    found.setdefault(name, str(item))
        except Exception:
            pass

print(f"今天 ({today}) 检测到的包（共 {len(found)} 个）：")
print("-" * 60)
for name in sorted(found):
    print(f"{name}    ->  {found[name]}")