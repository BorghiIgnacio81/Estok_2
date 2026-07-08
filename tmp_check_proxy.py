import json, sys
labels = json.load(sys.stdin)
for k, v in labels.items():
    if 'estok' in k.lower() or 'estok' in v.lower() or 'eeestok' in v.lower():
        print(f"{k} = {v}")
