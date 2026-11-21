import csv, json

dict_list = []
with open('ecdict.csv', 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        # 筛选高频词（有柯林斯星级、牛津3000核心标记或词频排名靠前）
        if row.get('oxford') == '1' or row.get('collins') in ['1','2','3','4','5'] or (row.get('frq') and int(row['frq']) <= 30000):
            word = row['word'].strip().lower()
            if not word.isalpha(): continue
            is_core = (row.get('oxford') == '1' or row.get('collins') in ['1','2','3'])
            dict_list.append({
                "word": word,
                "ipa": f"[{row['phonetic']}]" if row.get('phonetic') else "",
                "level": "core" if is_core else "basic",
                "tier": "red" if is_core else "normal",
                "defaultGloss": row['translation'].split('\\n')[0].split('；')[0][:12],
                "defs": [{"pos": row.get('pos', ''), "meaning": row['translation'].replace('\\n', '；')}]
            })

with open('ecdict_50k_ready.json', 'w', encoding='utf-8') as out:
    json.dump(dict_list, out, ensure_ascii=False)
print(f"转换完成，共导出 {len(dict_list)} 个词汇！")