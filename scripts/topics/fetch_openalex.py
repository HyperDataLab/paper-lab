"""Fetch a seeded sample of open, published research articles with abstracts from OpenAlex.

Usage: python fetch_openalex.py <out.jsonl>
No contact details are sent. Data stays local (D:\\pl-topics\\data), never committed.
"""
import json
import sys
import urllib.parse
import urllib.request

SOURCES = {"ESWA": "S13144211", "KBS": "S10169007"}
PER_SOURCE = 150
SEED = 2026


def abstract(inverted):
    if not inverted:
        return ""
    words = {}
    for word, positions in inverted.items():
        for pos in positions:
            words[pos] = word
    return " ".join(words[i] for i in sorted(words))


def fetch(source_id):
    params = {
        "filter": ",".join(
            [
                f"primary_location.source.id:{source_id}",
                "type:article",
                "publication_year:2020-2025",
                "open_access.is_oa:true",
                "has_abstract:true",
            ]
        ),
        "sample": str(PER_SOURCE),
        "seed": str(SEED),
        "per-page": "200",
        "select": "id,doi,title,publication_year,abstract_inverted_index,primary_topic,keywords",
    }
    url = "https://api.openalex.org/works?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "paperlab-topic-spike"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)["results"]


def main(out):
    rows = []
    for name, sid in SOURCES.items():
        for w in fetch(sid):
            text = abstract(w.get("abstract_inverted_index"))
            if len(text.split()) < 40:
                continue
            topic = w.get("primary_topic") or {}
            rows.append(
                {
                    "journal": name,
                    "id": w["id"],
                    "doi": w.get("doi"),
                    "year": w.get("publication_year"),
                    "title": w.get("title") or "",
                    "abstract": text,
                    "oa_topic": topic.get("display_name"),
                    "oa_subfield": (topic.get("subfield") or {}).get("display_name"),
                    "oa_keywords": [k.get("display_name") for k in (w.get("keywords") or [])],
                }
            )
    with open(out, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    by = {n: sum(r["journal"] == n for r in rows) for n in SOURCES}
    print(f"wrote {len(rows)} papers {by}")


if __name__ == "__main__":
    main(sys.argv[1])
