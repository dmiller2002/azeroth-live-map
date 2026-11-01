#!/usr/bin/env python3
"""Extract visible TBC item appearance IDs from a CMaNGOS item_template dump."""
import argparse
import gzip
import json
from pathlib import Path
import re

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('sql', type=Path, help='CMaNGOS TBC full database .sql or .sql.gz')
args = parser.parse_args()
row = re.compile(r"\((\d+),\d+,\d+,-?\d+,'(?:\\.|[^'\\])*',(\d+),\d+,\d+,\d+,\d+,\d+,(\d+),")
visible = {1,3,4,5,6,7,8,9,10,13,14,15,16,17,19,20,21,22,23,25,26,28}
models = {}
opener = gzip.open if args.sql.suffix == '.gz' else open
with opener(args.sql, 'rt', encoding='utf-8') as source:
    for line in source:
        if not line.startswith('INSERT INTO `item_template`'):
            continue
        for match in row.finditer(line):
            item, display, slot = map(int, match.groups())
            if display and slot in visible:
                models[item] = [display, slot]
target = Path(__file__).resolve().parent.parent / 'dist/item-models.json'
target.write_text(json.dumps(models, separators=(',', ':')))
print(f'Extracted {len(models)} visible item appearances to {target}')
