import re
from collections import Counter, defaultdict


def abstract_of(inverted):
    words = {position: word for word, positions in (inverted or {}).items() for position in positions}
    return " ".join(words[i] for i in sorted(words))


def stability(a, b):
    pairs = defaultdict(Counter)
    for x, y in zip(a, b):
        pairs[x][y] += 1
    best = {x: counts.most_common(1)[0][0] for x, counts in pairs.items()}
    return sum(1 for x, y in zip(a, b) if best[x] == y) / len(a) if a else 0


def map_members(members):
    result = []
    for member in members:
        value = (member.get("openalexId") or "").rsplit("/", 1)[-1]
        result.append({**member, "openalexId": value if re.fullmatch(r"W[0-9]+", value) else None})
    return result
