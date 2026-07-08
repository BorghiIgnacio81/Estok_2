import json, sys
labels = json.load(sys.stdin)
for k, v in labels.items():
    if 'sq64' in str(v) or 'eeestok' in str(v):
        print(f"{k} = {v}")
