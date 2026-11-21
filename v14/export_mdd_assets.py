#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
MDD 资源导出 —— 把词典 mdd 里的图片/字体解出来，供"原版排版"使用。

为什么不导音频：
    朗文的 mdd 1.2GB，其中 99% 是 mp3；麦克米伦音频也有 398MB。
    而本程序已经有浏览器 TTS 发音，导出这 1.6GB 只为了点一下喇叭，不值。
    音频改为前端拦截 sound:// 链接 → 调 TTS 朗读该词（音质还更好）。

导出什么：
    .png .jpg .jpeg .gif .svg .webp .ico .bmp .ttf .otf .woff .woff2 .eot
    （字体必须导，牛津的 CSS 里有 @font-face，不导排版会变样）

用法：
    python export_mdd_assets.py --list          看要导出哪些
    python export_mdd_assets.py --all           全量导出
    python export_mdd_assets.py --only oald10   只导一本
    python export_mdd_assets.py --all --force   覆盖已有文件

输出目录：F:\\EnglishReaderDataDict\\dict_assets\\<code>\\<原路径>
"""

import sys
import types

try:
    import lzo  # noqa: F401
except ModuleNotFoundError:
    _stub = types.ModuleType("lzo")

    def _no_lzo(*_a, **_k):
        raise RuntimeError("该 MDD 使用 LZO 压缩，需要 python-lzo（本脚本目标文件都是 zlib）")

    _stub.decompress = _no_lzo
    sys.modules["lzo"] = _stub

import argparse
import os
import time

from readmdict import MDD

BASE = r"F:\EnglishReaderDataDict"
OUT_ROOT = os.path.join(BASE, "dict_assets")

KEEP_EXT = {
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".bmp",
    ".ttf", ".otf", ".woff", ".woff2", ".eot",
}

TARGETS = [
    {
        "code": "oald10",
        "mdds": [os.path.join(BASE, "牛津高阶英汉双解词典第10版", "牛津高阶英汉双解词典第10版.mdd")],
    },
    {
        "code": "ldoce6",
        "mdds": [os.path.join(BASE, "LDOCE6EnEn_v2026.11.14", "LDOCE6EnEn.mdd")],
    },
    {
        # 麦克米伦用拆分后的"图片"那份（71MB），别去碰 451MB 的合并包
        "code": "macmillan",
        "mdds": [os.path.join(BASE, "Macmillan-British-English-2019部分双解版", "mdd拆分",
                              "Macmillan-British-English-2019-2.mdd")],
    },
    {
        # 同义词典与主词典共用一套图片，指向同一个目录，不重复导
        "code": "macmillan-thes",
        "mdds": [],
        "alias_of": "macmillan",
    },
]

MAX_FILE = 8 * 1048576       # 单文件超过 8MB 跳过（个别超清插画）


def normalize_key(raw_key: str) -> str:
    """mdd 里的键形如 \\img\\airliner.jpg，转成 img/airliner.jpg"""
    key = raw_key.replace("\\", "/").lstrip("/")
    # 去掉可能带上的盘符式前缀
    while key.startswith("./"):
        key = key[2:]
    return key


def export_one(cfg, force=False):
    code = cfg["code"]
    if cfg.get("alias_of"):
        print(f"   {code}: 用 {cfg['alias_of']} 的资源，跳过")
        return 0, 0

    out_dir = os.path.join(OUT_ROOT, code)
    total_files = 0
    total_bytes = 0
    skipped = 0

    for mdd_path in cfg["mdds"]:
        if not os.path.isfile(mdd_path):
            print(f"   ⚠️ 缺少 {mdd_path}")
            continue
        size_mb = os.path.getsize(mdd_path) / 1048576
        print(f"   扫描 {os.path.basename(mdd_path)}（{size_mb:.0f} MB）…")
        t0 = time.time()
        mdd = MDD(mdd_path)
        n = 0
        for key_bytes, data in mdd.items():
            n += 1
            if n % 20000 == 0:
                print(f"      {n} 条, 已导出 {total_files} 个文件 / "
                      f"{total_bytes/1048576:.0f} MB, {n/max(0.001, time.time()-t0):.0f} 条/秒", flush=True)

            rel = normalize_key(key_bytes.decode("utf-8", "ignore"))
            ext = os.path.splitext(rel)[1].lower()
            if ext not in KEEP_EXT:
                skipped += 1
                continue
            if len(data) > MAX_FILE:
                skipped += 1
                continue
            if not rel or ".." in rel:
                continue

            target = os.path.join(out_dir, rel.replace("/", os.sep))
            if os.path.exists(target) and not force:
                continue
            try:
                os.makedirs(os.path.dirname(target), exist_ok=True)
                with open(target, "wb") as f:
                    f.write(data)
                total_files += 1
                total_bytes += len(data)
            except Exception as e:
                print(f"      ⚠️ 写入失败 {rel}: {e}")

        print(f"   扫完 {n} 条，用时 {time.time()-t0:.0f}s")

    print(f"   ✅ {code}: 导出 {total_files} 个文件，{total_bytes/1048576:.1f} MB"
          f"（跳过 {skipped} 条非图片/字体）\n")
    return total_files, total_bytes


def cmd_list():
    print(f"导出目录：{OUT_ROOT}\n")
    for cfg in TARGETS:
        if cfg.get("alias_of"):
            print(f"{cfg['code']:<18} → 共用 {cfg['alias_of']} 的资源")
            continue
        exist = sum(os.path.getsize(os.path.join(dp, f))
                    for dp, _, fs in os.walk(os.path.join(OUT_ROOT, cfg["code"]))
                    for f in fs) if os.path.isdir(os.path.join(OUT_ROOT, cfg["code"])) else 0
        cnt = sum(len(fs) for _, _, fs in os.walk(os.path.join(OUT_ROOT, cfg["code"]))) \
            if os.path.isdir(os.path.join(OUT_ROOT, cfg["code"])) else 0
        print(f"{cfg['code']:<18} 已导出 {cnt} 个 / {exist/1048576:.1f} MB")
        for p in cfg["mdds"]:
            ok = "存在" if os.path.isfile(p) else "缺失"
            sz = f"{os.path.getsize(p)/1048576:.0f}MB" if os.path.isfile(p) else "-"
            print(f"{'':<18} {ok:<6}{sz:<8}{p}")


def main():
    ap = argparse.ArgumentParser(description="MDD 图片/字体资源导出")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--only", default="")
    ap.add_argument("--force", action="store_true", help="覆盖已存在文件")
    args = ap.parse_args()

    if args.list:
        cmd_list()
        return

    codes = [c.strip() for c in args.only.split(",") if c.strip()]
    targets = [c for c in TARGETS if (args.all or not codes) or c["code"] in codes]
    if not targets:
        ap.print_help()
        return

    t0 = time.time()
    files = bytes_ = 0
    for cfg in targets:
        f, b = export_one(cfg, force=args.force)
        files += f
        bytes_ += b

    print("=" * 68)
    print(f"全部完成：{files} 个文件，{bytes_/1048576:.1f} MB，用时 {time.time()-t0:.0f}s")
    print(f"目录：{OUT_ROOT}")


if __name__ == "__main__":
    main()
