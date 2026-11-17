import re
import math
from collections import Counter, defaultdict


def percentile(values, fraction):
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def topic_fit(embeddings, topics, weak_fit_percentile=0.10):
    def normalize(vector):
        length = math.sqrt(sum(float(value) ** 2 for value in vector))
        return [float(value) / length for value in vector] if length else [0.0 for _ in vector]

    vectors = [normalize(vector) for vector in embeddings]
    topics = [int(topic) for topic in topics]  # numpy ints would make weak a numpy bool, which the schema rejects
    groups = defaultdict(list)
    for vector, topic in zip(vectors, topics):
        if topic != -1:
            groups[int(topic)].append(vector)
    centroids = {topic: normalize([sum(values) / len(members) for values in zip(*members)])
                 for topic, members in groups.items()}
    results = []
    for vector, topic in zip(vectors, topics):
        if topic == -1:
            results.append({"fit": None, "nearest": None, "margin": None, "weak": True, "reason": "unassigned"})
            continue
        scores = {tid: sum(a * b for a, b in zip(vector, centroid)) for tid, centroid in centroids.items()}
        own = scores[topic]
        others = {tid: score for tid, score in scores.items() if tid != topic}
        best_other = max(others, key=others.get) if others else None
        nearest = best_other if best_other is not None and others[best_other] > own else int(topic)
        results.append({"fit": own, "nearest": nearest,
                        "margin": own - others[best_other] if best_other is not None else None,
                        "weak": nearest != topic,
                        "reason": "closer-to-other-topic" if nearest != topic else None})
    threshold = percentile([result["fit"] for result in results if result["fit"] is not None], weak_fit_percentile)
    for result in results:
        if result["fit"] is not None and result["fit"] < threshold and not result["weak"]:
            result["weak"] = True
            result["reason"] = "low-fit"
    return results


def abstract_of(inverted):
    words = {position: word for word, positions in (inverted or {}).items() for position in positions}
    return " ".join(words[i] for i in sorted(words))


def stability(a, b):
    pairs = defaultdict(Counter)
    for x, y in zip(a, b):
        pairs[x][y] += 1
    best = {x: counts.most_common(1)[0][0] for x, counts in pairs.items()}
    return sum(1 for x, y in zip(a, b) if best[x] == y) / len(a) if a else 0


def subfield_id(subfield):
    """OpenAlex `https://openalex.org/subfields/1702` -> `subfields/1702`; None when absent or malformed."""
    value = re.sub(r"^https?://openalex\.org/", "", ((subfield or {}).get("id") or "").strip())
    return value if re.fullmatch(r"subfields/[0-9]+", value) else None


def top_subfields(members, limit=3):
    """Most common OpenAlex subfields by name; `id` is added only when a member carried one."""
    counts = Counter(m.get("oa_subfield") for m in members if m.get("oa_subfield"))
    ids = {}
    for m in members:
        if m.get("oa_subfield") and m.get("oa_subfield_id"):
            ids.setdefault(m["oa_subfield"], m["oa_subfield_id"])
    return [{"name": n, **({"id": ids[n]} if n in ids else {}), "count": c} for n, c in counts.most_common(limit)]


def map_members(members):
    result = []
    for member in members:
        value = (member.get("openalexId") or "").rsplit("/", 1)[-1]
        result.append({**member, "openalexId": value if re.fullmatch(r"W[0-9]+", value) else None})
    return result
