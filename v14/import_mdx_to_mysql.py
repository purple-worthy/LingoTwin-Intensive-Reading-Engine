#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
MDX 词典导入 MySQL —— 把多本 MDict/欧路词典(.mdx)的正文抽进 ecdict 库，
与原有的 stardict(340 万词 ECDICT) 并存，供查词时做"多来源对照"。

作者备注（踩过的坑，改之前先看）：
  1. readmdict 0.1.1 的 __init__.py 在缺 lzo 时直接 raise SystemExit。
     但四本目标词典都是 engine 2.0（zlib），根本不需要 lzo，
     所以这里预注册一个假 lzo 模块绕过它（真遇到 LZO 块会抛出明确错误）。
  2. lxml 在本机是坏的（ImportError: cannot import name 'etree'），
     所以解析器自动降级：能 import lxml 就用，否则 bs4 + html.parser（纯 Python）。
  3. 三本词典的 HTML 结构完全不同，不能靠一套通用 class 正则硬套，
     这里按 code 配了抽取画像（profile），各自用自己真实的选择器。

用法：
  python import_mdx_to_mysql.py --list                 列出词典与文件状态
  python import_mdx_to_mysql.py --sample happy         只抽一个词打印出来看效果（不写库）
  python import_mdx_to_mysql.py --all                  导入全部（已存在的词条会更新）
  python import_mdx_to_mysql.py --only oald10,ldoce6   只导指定词典
  python import_mdx_to_mysql.py --reset oald10         先清空该来源再导
  python import_mdx_to_mysql.py --all --no-raw         不存原始 HTML（省 300MB 左右）

产出两张表：
  dict_sources  词典来源登记（code / 名称 / 条目数 / 导入时间 / 是否启用）
  dict_entries  词条正文（word + source_code 唯一，含音标、词性、释义、例句、压缩原文）
"""

# ---------------------------------------------------------------- lzo 桩（必须在 readmdict 之前）
import sys
import types

try:                                    # 真装了 python-lzo 就直接用
    import lzo  # noqa: F401
except ModuleNotFoundError:
    _stub = types.ModuleType("lzo")

    def _lzo_missing(*_a, **_k):
        raise RuntimeError(
            "该 MDX 使用 LZO 压缩，需要先 pip install python-lzo。"
            "（本脚本内置的四本词典都是 zlib，不需要它）"
        )

    _stub.decompress = _lzo_missing
    sys.modules["lzo"] = _stub

import argparse
import json
import os
import re
import time
import zlib

import pymysql
from bs4 import BeautifulSoup

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

# ============================================================ 配置
MYSQL_CONFIG = {
    "host": os.getenv("LT_DB_HOST", "127.0.0.1"),
    "port": int(os.getenv("LT_DB_PORT", "3306")),
    "user": os.getenv("LT_DB_USER", "root"),
    "password": os.getenv("LT_DB_PASSWORD", "123456"),
    "database": os.getenv("LT_DB_NAME", "ecdict"),
    "charset": "utf8mb4",
}

BASE = r"F:\EnglishReaderDataDict"

# 每本词典一条：code 是稳定标识（会写进 dict_entries.source_code，别乱改）
DICTS = [
    {
        "code": "oald10",
        "name": "牛津高阶英汉双解词典（第10版）",
        "short": "牛津10",
        "order": 10,
        "profile": "oald10",
        "mdx": os.path.join(BASE, "牛津高阶英汉双解词典第10版", "牛津高阶英汉双解词典第10版.mdx"),
        "css": "oald10.css",
    },
    {
        "code": "ldoce6",
        "name": "朗文当代高级英语辞典（第6版）",
        "short": "朗文6",
        "order": 20,
        "profile": "ldoce6",
        "mdx": os.path.join(BASE, "LDOCE6EnEn_v2026.11.14", "LDOCE6EnEn.mdx"),
        "css": "LDOCE6EnEn.css",
    },
    {
        "code": "macmillan",
        "name": "麦克米伦英式英语词典（2019 部分双解）",
        "short": "麦克米伦",
        "order": 30,
        "profile": "macmillan",
        "mdx": os.path.join(BASE, "Macmillan-British-English-2019部分双解版",
                            "Macmillan-British-English-2019-2.mdx"),
        "css": "entry.css",
    },
    {
        "code": "macmillan-thes",
        "name": "麦克米伦同义词词典（2019）",
        "short": "麦同义",
        "order": 40,
        "profile": "macmillan",
        "mdx": os.path.join(BASE, "Macmillan-British-English-2019部分双解版",
                            "Macmillan Thesaurus.mdx"),
        "css": "mmt.css",
    },
]

MAX_EXAMPLES = 6
BATCH_SIZE = 500
MAX_RAW_STORE = 400_000        # 单条原文超过 400KB 就不存原文了（避免个别巨型条目撑爆包）
LOCAL_DICTS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dicts.local.json")


def load_dicts():
    """内置配置 + dicts.local.json 覆盖。

    加新词典不用改这个文件：在 dicts.local.json 里写一条同结构的配置即可，
    code 相同的会做字段级合并（只覆盖你写的那几个字段）。
    """
    merged = {d["code"]: dict(d) for d in DICTS}
    if os.path.isfile(LOCAL_DICTS_FILE):
        try:
            with open(LOCAL_DICTS_FILE, "r", encoding="utf-8") as f:
                extra = json.load(f)
            for d in extra if isinstance(extra, list) else extra.get("dicts", []):
                if not d.get("code"):
                    continue
                merged[d["code"]] = {**merged.get(d["code"], {}), **d}
            print(f"（已合并 {LOCAL_DICTS_FILE}）")
        except Exception as e:
            print(f"⚠️ {LOCAL_DICTS_FILE} 解析失败，只用内置配置：{e}")
    return list(merged.values())

# ============================================================ 表结构
DDL_SOURCES = """
CREATE TABLE IF NOT EXISTS dict_sources (
    code        VARCHAR(32)  NOT NULL PRIMARY KEY,
    name        VARCHAR(120) NOT NULL,
    short_name  VARCHAR(24)  NOT NULL DEFAULT '',
    mdx_file    VARCHAR(255) NOT NULL DEFAULT '',
    css_file    VARCHAR(128) NOT NULL DEFAULT '',
    entry_count INT          NOT NULL DEFAULT 0,
    imported_at BIGINT       NOT NULL DEFAULT 0,
    enabled     TINYINT      NOT NULL DEFAULT 1,
    sort_order  INT          NOT NULL DEFAULT 99
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""

DDL_ENTRIES = """
CREATE TABLE IF NOT EXISTS dict_entries (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    word          VARCHAR(128) NOT NULL,
    source_code   VARCHAR(32)  NOT NULL,
    phonetic      VARCHAR(160) NOT NULL DEFAULT '',
    pos           VARCHAR(64)  NOT NULL DEFAULT '',
    definition    MEDIUMTEXT,
    definition_en MEDIUMTEXT,
    definition_zh MEDIUMTEXT,
    examples      MEDIUMTEXT,
    is_redirect   TINYINT      NOT NULL DEFAULT 0,
    redirect_to   VARCHAR(128) NOT NULL DEFAULT '',
    raw_z         MEDIUMBLOB,
    raw_size      INT          NOT NULL DEFAULT 0,
    created_at    BIGINT       NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uk_word_source (word, source_code),
    KEY idx_word (word),
    KEY idx_source (source_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
"""


# ============================================================ 解析器
# 说明：bs4 就算底层挂 lxml，也会给每个标签包一层 Python 对象，实测只有 55 条/秒。
# 直接用 lxml + cssselect 走原生节点，同样的词条能快 5~8 倍（朗文 15 万条从 75 分钟降到 15 分钟）。
try:
    import lxml.html as _LH
    import cssselect  # noqa: F401  (lxml 的 .cssselect() 依赖它)
    _HAVE_LXML = True
except Exception:
    _HAVE_LXML = False

PARSER = "lxml" if _HAVE_LXML else "html.parser"


class LxmlDoc:
    """只实现抽取用到的那几个方法，接口对齐 bs4，好让画像函数两边通用。"""

    __slots__ = ("root",)

    def __init__(self, html_text):
        try:
            self.root = _LH.fromstring(html_text)
        except Exception:
            self.root = _LH.fromstring("<html></html>")
        for bad in self.root.xpath("//script|//style|//link|//meta"):
            parent = bad.getparent()
            if parent is not None:
                parent.remove(bad)

    def select(self, sel):
        try:
            return self.root.cssselect(sel)
        except Exception:
            return []

    def select_one(self, sel):
        found = self.select(sel)
        return found[0] if found else None


def make_doc(raw_html, profile):
    """已适配的词典走 lxml；generic 兜底仍用 bs4（它要遍历并改造 DOM）。"""
    if _HAVE_LXML and profile != "generic":
        return LxmlDoc(raw_html)
    return BeautifulSoup(raw_html, PARSER)


# ============================================================ 文本工具
_WS = re.compile(r"[\s\u00a0]+")
_PHON_SLASH = re.compile(r"/\s*([^/<>]{1,40}?)\s*/")
_BULLET = re.compile(r"^[·•▪◦●\-\u2013\u2014\s]+")
_PUNCT_SPACE = re.compile(r"\s+([,.;:!?，。；：、！？）】》」』])")
_OPEN_SPACE = re.compile(r"([（【《「『])\s+")

# 词性标签的形态：小写字母开头，只含字母/点/连字符/空格，最长 24 字符。
# 不再用白名单（会漏 det. / definite article 这种），改用"形态 + 小标题黑名单"。
_POS_SHAPE = re.compile(r"^[a-z][a-z.\- ]{0,23}$")

# 段落小标题，长得像词性但不是
_POS_SECTION = {
    "idioms", "idm", "phr v", "phr v.", "phrasal verbs", "word family",
    "synonyms", "collocations", "grammar", "usage", "more like this",
    "extra examples", "homophones", "noun phrases", "verb forms",
}

# 段落小标题，不是词性
_POS_SECTION = {
    "idioms", "idm", "phr v", "phr v.", "phrasal verbs", "word family",
    "synonyms", "collocations", "grammar", "usage", "more like this",
    "extra examples", "homophones", "noun phrases", "verb forms",
}


def squash(text: str) -> str:
    return _WS.sub(" ", (text or "")).strip()


def tidy(text: str) -> str:
    """压缩空白 + 去掉标点/括号前的多余空格（bs4 用空格拼内联标签会留下 'events ,'）。"""
    t = _BULLET.sub("", squash(text))
    t = _PUNCT_SPACE.sub(r"\1", t)
    t = _OPEN_SPACE.sub(r"\1", t)
    return t


def lines_of(text: str):
    """按换行切成非空行，顺带去重保序（词典里重复行很多）。"""
    seen, out = set(), []
    for raw in (text or "").split("\n"):
        t = tidy(raw)
        if not t or t in seen:
            continue
        seen.add(t)
        out.append(t)
    return out


def node_text(node) -> str:
    if node is None:
        return ""
    if hasattr(node, "itertext"):          # lxml 元素
        return tidy(" ".join(node.itertext()))
    return tidy(node.get_text(" ", strip=True))


def pick_text(soup, selectors, limit=1):
    """按候选选择器依次尝试，返回第一个命中的文本（可多取）。"""
    for sel in selectors:
        els = find_all(soup, sel)
        if els:
            vals = [node_text(e) for e in els[:limit]]
            vals = [v for v in vals if v]
            if vals:
                return vals
    return []


def find_all(node, sel):
    """同时兼容 lxml 元素（cssselect）和 bs4 元素（select）。"""
    if node is None:
        return []
    if hasattr(node, "cssselect"):
        try:
            return node.cssselect(sel)
        except Exception:
            return []
    try:
        return node.select(sel)
    except Exception:
        return []


def find_one(node, sel):
    found = find_all(node, sel)
    return found[0] if found else None


def clean_pos(vals) -> str:
    """把候选词性清洗、去重、按出现顺序拼起来（最多 4 个）。

    规则：丢掉小标题（IDIOMS / PHRASAL VERBS / PHR V 这类）、丢掉全大写、
    只留形似词性的短标签。这样 det. / definite article / exclam. 都不会被误杀。
    """
    out = []
    for v in vals:
        t = tidy(v).strip(" .,;:")
        if not t or len(t) > 24:
            continue
        low = t.lower()
        if low in _POS_SECTION:
            continue
        if t.isupper() and len(t) > 2:        # 全大写 = 段落小标题
            continue
        if not _POS_SHAPE.match(low):
            continue
        if low not in [o.lower() for o in out]:
            out.append(t)
    return "/".join(out[:4])


def compact_text(node) -> str:
    """不含空格的文本，用来比对词头（bs4 的 .hwd 里常被 <span> 拆成 hap + py）。"""
    if node is None:
        return ""
    if hasattr(node, "itertext"):
        return "".join(node.itertext()).strip().lower()
    return "".join(node.stripped_strings).strip().lower()


def clean_phonetic(raw: str) -> str:
    t = squash(raw)
    if not t:
        return ""
    m = _PHON_SLASH.search(t)          # 有 /.../ 就取里面的
    if m:
        t = m.group(1)
    t = t.strip("/[] ")
    if len(t) > 48 or len(t.split()) > 6:   # 明显不是音标（整句英文）就丢掉
        return ""
    return t


# ============================================================ 抽取画像
# 每个画像统一返回 dict：
#   phonetic_uk / phonetic_us / pos / pos_stats / merged / en / zh / examples / extras
# extras 是 JSON：synonyms / antonyms / phrases / collocations / synDisc


def _first_text(doc, sel):
    return node_text(find_one(doc, sel))


def _clean_item(t, limit=60):
    """去掉图标字符（◆、菱形）和中文前缀（"同义词fortunate" → "fortunate"）。"""
    t = re.sub(r"^[^A-Za-z(\[]+", "", tidy(t))
    return t[:limit]


def _uniq(items, limit=20, clean=True):
    out = []
    for x in items:
        x = _clean_item(x) if clean else tidy(x)
        if x and x not in out:
            out.append(x)
    return out[:limit]


def extract_oald10(doc, word=""):
    """牛津10：英释与中释分列；英美音标各有独立节点；习语/辨析是独立块。"""
    uk = _first_text(doc, ".o-pron-chunk.o-pron-BrE .o-pron-phon")
    us = _first_text(doc, ".o-pron-chunk.o-pron-NAmE .o-pron-phon")
    if not uk:                                   # 只有一条时通常就是英音
        uk = _first_text(doc, ".o-pron-phon")

    tabs = [node_text(e) for e in find_all(doc, ".o-pos-tab")]
    pos = clean_pos(tabs if tabs else [node_text(e) for e in find_all(doc, ".o-pos-tag")])

    # 每个词性段落里有几个义项 → 算词性占比
    pos_stats = []
    for d in find_all(doc, ".o-pos-detail"):
        p = clean_pos([node_text(t) for t in find_all(d, ".o-pos-tag")])
        n = len(find_all(d, ".o-sense"))
        if p and n:
            pos_stats.append({"pos": p, "n": n})

    en, zh, merged = [], [], []
    for s in find_all(doc, ".o-sense"):
        e = node_text(find_one(s, ".o-def-eng"))
        z = node_text(find_one(s, ".o-def-simp"))
        if e:
            en.append(e)
        if z:
            zh.append(z)
        if e or z:
            merged.append(f"{e} {z}".strip())

    ex = []
    for row in find_all(doc, ".o-example-row"):
        e = node_text(find_one(row, ".o-example-eng"))
        z = node_text(find_one(row, ".o-example-simp"))
        t = f"{e}\t{z}" if (e and z) else (e or z)
        if t:
            ex.append(t)

    extras = {
        "synonyms": _uniq([node_text(e) for e in find_all(doc, ".o-ref-syn")]
                          + [node_text(e) for e in find_all(doc, ".o-unbox-ul .o-unbox-li")], 24),
        "antonyms": _uniq([node_text(e).replace("≠", " ") for e in find_all(doc, ".o-word-family-opp")], 12),
        "phrases": _uniq([node_text(e) for e in find_all(doc, ".o-idiom")], 16),
        "synDisc": _uniq([node_text(e) for e in find_all(doc, ".o-unbox-panel")], 2, clean=False),
    }
    return {
        "phonetic_uk": clean_phonetic(uk), "phonetic_us": clean_phonetic(us),
        "pos": pos, "pos_stats": pos_stats,
        "merged": merged, "en": en, "zh": zh,
        "examples": ex[:MAX_EXAMPLES], "extras": extras,
    }


def extract_ldoce6(doc, word=""):
    """朗文6（英英）：THESAURUS 同义词框、OPP 反义词、phrasetext 短语、colloc 搭配。

    美国音只给了"差异后缀"（amevarpron，如 $-ərd），拼不出完整音标，所以只存英音。
    """
    uk = _first_text(doc, ".entryhead .pron")

    vals = [node_text(e) for e in find_all(doc, ".entryhead > .pos")]
    if not vals:
        vals = [node_text(e) for e in find_all(doc, ".entryhead .pos")][:4]
    pos = clean_pos(vals)

    defs = []
    for s in find_all(doc, ".sense"):
        t = node_text(find_one(s, ".def"))
        if t:
            defs.append(t)
    if not defs:
        defs = pick_text(doc, [".def"], 8)

    # 必须用 .sense > .example：裸 .example 会把其他词条/同义框里的例句一起捞进来
    # （tomato 会抓到 "Bean plants are easy to grow."）
    ex = []
    for e in find_all(doc, ".sense > .example"):
        t = node_text(e)
        if len(t) > 8:
            ex.append(t)

    extras = {
        "antonyms": _uniq([node_text(e) for e in find_all(doc, ".opp")], 12),
        "phrases": _uniq([node_text(e) for e in find_all(doc, ".phrasetext")], 16),
        "collocations": _uniq([node_text(e) for e in find_all(doc, ".colloc")], 14),
        "synDisc": _uniq([node_text(e) for e in find_all(doc, ".thesbox")], 1, clean=False),
    }
    return {
        "phonetic_uk": clean_phonetic(uk), "phonetic_us": "",
        "pos": pos, "pos_stats": [],
        "merged": lines_of("\n".join(defs)), "en": [], "zh": [],
        "examples": lines_of("\n".join(ex))[:MAX_EXAMPLES], "extras": extras,
    }


def extract_macmillan(doc, word=""):
    """麦克米伦：DEFINITION/EXAMPLE 本身中英混排；THES 是同义词/联想词框。"""
    uk = _first_text(doc, ".PRON")

    head = find_all(doc, "#headbar .PART-OF-SPEECH") or find_all(doc, ".PART-OF-SPEECH")
    vals = []
    for e in head:
        vals += [x for x in re.split(r"[,/]", node_text(e)) if x.strip()]
    pos = clean_pos(vals)

    defs = pick_text(doc, [".DEFINITION"], 10)
    ex = [t for t in pick_text(doc, [".EXAMPLE"], 40) if len(t) > 8]

    extras = {
        "collocations": _uniq([node_text(e) for e in find_all(doc, ".ONE-COLLOCATE")], 14),
        "synDisc": _uniq([node_text(e) for e in find_all(doc, ".THES")], 2, clean=False),
    }
    return {
        "phonetic_uk": clean_phonetic(uk), "phonetic_us": "",
        "pos": pos, "pos_stats": [],
        "merged": lines_of("\n".join(defs)), "en": [], "zh": [],
        "examples": lines_of("\n".join(ex))[:MAX_EXAMPLES], "extras": extras,
    }


def extract_generic(doc, word=""):
    """兜底：不认结构，只把可见文本按块捋出来。新词典先用这个跑通。"""
    for br in doc.find_all(["br", "p", "div", "li", "tr", "h1", "h2", "h3"]):
        br.insert_after("\n")
    text = doc.get_text("", strip=False)
    body = lines_of(text)
    phon = ""
    m = _PHON_SLASH.search(text)
    if m:
        phon = clean_phonetic(m.group(1))
    return {
        "phonetic_uk": phon, "phonetic_us": "", "pos": "", "pos_stats": [],
        "merged": body[:30], "en": [], "zh": [], "examples": [], "extras": {},
    }


PROFILES = {
    "oald10": extract_oald10,
    "ldoce6": extract_ldoce6,
    "macmillan": extract_macmillan,
    "generic": extract_generic,
}

_EMPTY_EXTRACT = {
    "phonetic_uk": "", "phonetic_us": "", "pos": "", "pos_stats": [],
    "merged": [], "en": [], "zh": [], "examples": [], "extras": {},
}


def parse_entry(profile: str, raw_html: str, word: str = ""):
    doc = make_doc(raw_html, profile)
    if not isinstance(doc, LxmlDoc):       # bs4 才需要手动拆噪音标签
        for tag in doc(["script", "style", "link", "meta"]):
            tag.decompose()
    fn = PROFILES.get(profile, extract_generic)
    data = fn(doc, word) or dict(_EMPTY_EXTRACT)
    return data

# ============================================================ DB
def connect():
    return pymysql.connect(cursorclass=pymysql.cursors.DictCursor, **MYSQL_CONFIG)


def ensure_schema(conn):
    with conn.cursor() as cur:
        cur.execute(DDL_SOURCES)
        cur.execute(DDL_ENTRIES)
    conn.commit()


def reset_source(conn, code):
    with conn.cursor() as cur:
        cur.execute("DELETE FROM dict_entries WHERE source_code = %s", (code,))
        n = cur.rowcount
        cur.execute("DELETE FROM dict_sources WHERE code = %s", (code,))
    conn.commit()
    print(f"   已清空 {code} 的 {n} 条词条")


INSERT_SQL = """
INSERT INTO dict_entries
  (word, source_code, phonetic, phonetic_uk, phonetic_us, pos, pos_stats,
   definition, definition_en, definition_zh, examples, extras,
   is_redirect, redirect_to, raw_z, raw_size, created_at)
VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
ON DUPLICATE KEY UPDATE
  phonetic=VALUES(phonetic), phonetic_uk=VALUES(phonetic_uk), phonetic_us=VALUES(phonetic_us),
  pos=VALUES(pos), pos_stats=VALUES(pos_stats),
  definition=VALUES(definition), definition_en=VALUES(definition_en),
  definition_zh=VALUES(definition_zh), examples=VALUES(examples), extras=VALUES(extras),
  is_redirect=VALUES(is_redirect), redirect_to=VALUES(redirect_to),
  -- 用 --no-raw 重跑时（比如只刷新词性）不要把已有原文冲掉
  raw_z=COALESCE(VALUES(raw_z), raw_z),
  raw_size=IF(VALUES(raw_z) IS NULL, raw_size, VALUES(raw_size))
"""


def import_one(conn, cfg, store_raw=True, limit=0, quiet=False):
    from readmdict import MDX

    code = cfg["code"]
    path = cfg["mdx"]
    if not os.path.isfile(path):
        print(f"   ⚠️ 跳过 {code}：文件不存在 {path}")
        return 0

    size_mb = os.path.getsize(path) / 1048576
    print(f"   加载 {cfg['name']}（{size_mb:.0f} MB）…")
    mdx = MDX(path)

    t0 = time.time()
    batch, total, redirects, skipped = [], 0, 0, 0

    for key, val in mdx.items():
        word = key.decode("utf-8", "ignore").strip().lower()
        if not word or len(word) > 120:
            skipped += 1
            continue

        raw = val.decode("utf-8", "ignore").strip()

        # @@@LINK= 是别名跳转，别丢：存成一条 redirect，查词时能提示"见 xxx"
        if raw.startswith("@@@LINK="):
            target = raw[len("@@@LINK="):].split("\n")[0].strip()
            batch.append((word, code, "", "", "", "", "", f"→ 见 {target}", "", "", "", "",
                          1, target[:128], None, 0, int(time.time())))
            redirects += 1
        else:
            d = parse_entry(cfg["profile"], raw, word)
            if not d["merged"]:
                skipped += 1
                continue
            blob = None
            raw_len = len(raw)
            if store_raw and raw_len <= MAX_RAW_STORE:
                blob = zlib.compress(raw.encode("utf-8"), 6)
            uk = (d.get("phonetic_uk") or "")[:160]
            batch.append((
                word, code, uk, uk, (d.get("phonetic_us") or "")[:160],
                (d.get("pos") or "")[:64],
                json.dumps(d.get("pos_stats") or [], ensure_ascii=False)[:255],
                "\n".join(d["merged"])[:60_000],
                "\n".join(d.get("en") or [])[:60_000],
                "\n".join(d.get("zh") or [])[:60_000],
                "\n".join(d.get("examples") or [])[:20_000],
                json.dumps(d.get("extras") or {}, ensure_ascii=False)[:60_000],
                0, "", blob, raw_len, int(time.time()),
            ))

        if len(batch) >= BATCH_SIZE:
            with conn.cursor() as cur:
                cur.executemany(INSERT_SQL, batch)
            conn.commit()
            total += len(batch)
            batch.clear()
            if not quiet:
                rate = total / max(0.001, time.time() - t0)
                print(f"      {total:>7} 条  {rate:>6.0f} 条/秒", flush=True)

        if limit and total + len(batch) >= limit:
            break

    if batch:
        with conn.cursor() as cur:
            cur.executemany(INSERT_SQL, batch)
        conn.commit()
        total += len(batch)

    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO dict_sources (code, name, short_name, mdx_file, css_file,
                                      entry_count, imported_at, enabled, sort_order)
            VALUES (%s,%s,%s,%s,%s,%s,%s,1,%s)
            ON DUPLICATE KEY UPDATE
              name=VALUES(name), short_name=VALUES(short_name), mdx_file=VALUES(mdx_file),
              css_file=VALUES(css_file), entry_count=VALUES(entry_count),
              imported_at=VALUES(imported_at), enabled=1, sort_order=VALUES(sort_order)
        """, (code, cfg["name"], cfg["short"], path, cfg.get("css", ""),
              total, int(time.time()), cfg.get("order", 99)))
    conn.commit()

    cost = time.time() - t0
    print(f"   ✅ {cfg['short']}：{total} 条（其中别名跳转 {redirects}，跳过 {skipped}），"
          f"耗时 {cost:.0f}s\n")
    return total


# ============================================================ 模式
def cmd_list():
    print(f"解析器：{PARSER}\n")
    print(f"{'code':<16}{'状态':<10}{'大小':<10}路径")
    print("-" * 100)
    for c in load_dicts():
        ok = "存在" if os.path.isfile(c["mdx"]) else "缺失"
        size = f"{os.path.getsize(c['mdx'])/1048576:.0f}MB" if os.path.isfile(c["mdx"]) else "-"
        print(f"{c['code']:<16}{ok:<10}{size:<10}{c['mdx']}")
        print(f"{'':<16}{c['name']}")


def cmd_sample(word, codes):
    from readmdict import MDX
    targets = [c for c in load_dicts() if not codes or c["code"] in codes]
    for cfg in targets:
        if not os.path.isfile(cfg["mdx"]):
            continue
        print("\n" + "=" * 92)
        print(f"{cfg['name']}  [{cfg['code']}]  查：{word}")
        raw = None
        for k, v in MDX(cfg["mdx"]).items():
            if k.decode("utf-8", "ignore").strip().lower() == word.lower():
                raw = v.decode("utf-8", "ignore")
                break
        if raw is None:
            print("   ✗ 没找到这个词条")
            continue
        if raw.startswith("@@@LINK="):
            print("   别名跳转 →", raw[8:].strip())
            continue
        d = parse_entry(cfg["profile"], raw, word)
        print(f"   英音: {d['phonetic_uk'] or '（无）'}   美音: {d['phonetic_us'] or '（无）'}")
        print(f"   词性: {d['pos'] or '（无）'}   占比: {d['pos_stats'] or '—'}")
        print(f"   原文长度: {len(raw)}")
        print("   释义:")
        for line in d["merged"][:5]:
            print(f"     · {line[:110]}")
        if d["zh"]:
            print("   中文单列: " + " | ".join(z[:28] for z in d["zh"][:4]))
        print("   例句:")
        for line in d["examples"][:3]:
            print(f"     · {line.replace(chr(9), ' // ')[:110]}")
        ex_keys = ("synonyms", "antonyms", "phrases", "collocations", "synDisc")
        got = [f"{k}={len(v)}" for k in ex_keys for v in [d["extras"].get(k) or []] if v]
        print("   板块: " + (" ".join(got) if got else "（无）"))


def cmd_import(codes, store_raw, reset, limit, quiet):
    conn = connect()
    try:
        ensure_schema(conn)
        print(f"解析器：{PARSER}｜批大小 {BATCH_SIZE}｜存原文：{'是' if store_raw else '否'}\n")
        targets = [c for c in load_dicts() if not codes or c["code"] in codes]
        if not targets:
            print("没有匹配的词典 code，用 --list 看可选项")
            return
        grand = 0
        for cfg in targets:
            if reset:
                reset_source(conn, cfg["code"])
            grand += import_one(conn, cfg, store_raw=store_raw, limit=limit, quiet=quiet)

        with conn.cursor() as cur:
            cur.execute("""
                SELECT source_code, COUNT(*) AS n, SUM(is_redirect) AS rd,
                       ROUND(SUM(LENGTH(definition))/1048576, 1) AS def_mb,
                       ROUND(SUM(raw_size)/1048576, 1) AS raw_mb
                FROM dict_entries GROUP BY source_code ORDER BY n DESC
            """)
            rows = cur.fetchall()
            cur.execute("""
                SELECT ROUND(SUM(data_length+index_length)/1024/1024,1) AS mb
                FROM information_schema.TABLES
                WHERE TABLE_SCHEMA=%s AND TABLE_NAME IN ('dict_entries','dict_sources')
            """, (MYSQL_CONFIG["database"],))
            size = cur.fetchone()["mb"]
        print("=" * 76)
        print(f"{'来源':<18}{'词条':>10}{'别名':>8}{'释义MB':>10}{'原文MB':>10}")
        for r in rows:
            print(f"{r['source_code']:<18}{r['n']:>10}{r['rd'] or 0:>8}"
                  f"{r['def_mb'] or 0:>10}{r['raw_mb'] or 0:>10}")
        print(f"\n本次写入 {grand} 条｜两表合计占用 {size} MB")
    finally:
        conn.close()


def main():
    ap = argparse.ArgumentParser(description="MDX 词典 → MySQL 导入器")
    ap.add_argument("--list", action="store_true", help="列出词典与文件状态")
    ap.add_argument("--all", action="store_true", help="导入全部词典")
    ap.add_argument("--only", default="", help="只导指定 code，逗号分隔")
    ap.add_argument("--sample", default="", help="只抽一个词打印结果，不写库")
    ap.add_argument("--reset", action="store_true", help="导入前清空该来源")
    ap.add_argument("--no-raw", action="store_true", help="不存原始 HTML")
    ap.add_argument("--limit", type=int, default=0, help="每个词典最多导多少条（调试用）")
    ap.add_argument("--quiet", action="store_true", help="不打印逐批进度")
    args = ap.parse_args()

    codes = [c.strip() for c in args.only.split(",") if c.strip()]

    if args.list:
        cmd_list()
    elif args.sample:
        cmd_sample(args.sample, codes)
    elif args.all or codes:
        cmd_import(codes, store_raw=not args.no_raw, reset=args.reset,
                   limit=args.limit, quiet=args.quiet)
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
