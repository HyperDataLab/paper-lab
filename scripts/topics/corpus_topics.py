"""Compute a corpus-topics-v1 snapshot with BERTopic + KeyBERT.

Usage:
  python corpus_topics.py --corpus target.json [--corpus control.json ...] --out snapshot.json
  python corpus_topics.py --sample sample.jsonl --out snapshot.json   (spike data, journal names as corpus ids)

Corpus files are PaperLab corpus exports (format "paperlab-corpus"). Abstracts are fetched from OpenAlex by each
member's OpenAlex id or DOI; nothing is sent besides those ids. Run with the venv in D:\\pl-topics.
"""
import argparse
import datetime as dt
import json
import time
import urllib.parse
import urllib.request
import uuid
from collections import Counter, defaultdict

import numpy as np
from bertopic import BERTopic
from bertopic.representation import KeyBERTInspired
from hdbscan import HDBSCAN
from keybert import KeyBERT
from sentence_transformers import SentenceTransformer
from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS, CountVectorizer
from sklearn.metrics import normalized_mutual_info_score
from umap import UMAP

import bertopic as _bt
import keybert as _kb

MODEL = "sentence-transformers/all-MiniLM-L6-v2"
DOMAIN_STOP = {
    "model", "models", "data", "dataset", "datasets", "method", "methods", "approach", "approaches", "proposed",
    "propose", "paper", "results", "result", "performance", "based", "using", "learning", "deep", "deep learning",
    "machine learning", "classification", "algorithm", "algorithms", "framework", "study", "experiments",
    "experimental", "novel", "state", "art", "existing", "problem", "problems", "task", "tasks", "network",
    "networks", "neural", "accuracy", "effectiveness", "application", "applications", "analysis", "new", "used",
}
PARAMS = {"umap_neighbors": 15, "umap_components": 5, "hdbscan_min_cluster": 6, "hdbscan_min_samples": 3,
          "hdbscan_selection": "leaf", "ngram_max": 3, "keybert_ngram_max": 2, "keybert_top_n": 6,
          "weak_probability": 0.3, "outlier_strategy": "embeddings"}


def openalex(params):
    url = "https://api.openalex.org/works?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "paperlab-corpus-topics"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)["results"]


def abstract_of(inverted):
    if not inverted:
        return ""
    words = {}
    for word, positions in inverted.items():
        for pos in positions:
            words[pos] = word
    return " ".join(words[i] for i in sorted(words))


def load_corpus(path):
    corpus = json.load(open(path, encoding="utf-8"))
    assert corpus.get("format") == "paperlab-corpus", f"{path} is not a PaperLab corpus export"
    members = []
    for m in corpus["members"]:
        ids = m.get("identifiers", {})
        members.append({"corpusId": corpus["id"], "memberId": m["memberId"], "title": m.get("title") or "",
                        "openalexId": (ids.get("openalexId") or "").rsplit("/", 1)[-1] or None,
                        "doi": (ids.get("doi") or "").lower() or None})
    meta = {"corpusId": corpus["id"], "kind": corpus["kind"], "title": corpus["title"]}
    if corpus.get("releaseId"):
        meta["releaseId"] = corpus["releaseId"]
    return meta, members


def fetch_texts(members):
    by_oa = {m["openalexId"]: m for m in members if m["openalexId"]}
    keys = list(by_oa)
    for i in range(0, len(keys), 50):
        chunk = keys[i:i + 50]
        for w in openalex({"filter": "openalex_id:" + "|".join(chunk), "per-page": "50",
                           "select": "id,title,abstract_inverted_index,primary_topic"}):
            m = by_oa.get(w["id"].rsplit("/", 1)[-1])
            if m:
                m["abstract"] = abstract_of(w.get("abstract_inverted_index"))
                m["title"] = m["title"] or (w.get("title") or "")
                m["oa_subfield"] = ((w.get("primary_topic") or {}).get("subfield") or {}).get("display_name")
        time.sleep(0.2)


def load_sample(path):
    members, corpora = [], {}
    for line in open(path, encoding="utf-8"):
        p = json.loads(line)
        cid = p["journal"]
        corpora[cid] = {"corpusId": cid, "kind": "journal" if cid == "ESWA" else "control", "title": cid}
        members.append({"corpusId": cid, "memberId": p["id"].rsplit("/", 1)[-1], "title": p["title"],
                        "abstract": p["abstract"], "oa_subfield": p.get("oa_subfield")})
    return list(corpora.values()), members


def fit(docs, emb, seed, model):
    vectorizer = CountVectorizer(stop_words=list(ENGLISH_STOP_WORDS | DOMAIN_STOP),
                                 ngram_range=(1, PARAMS["ngram_max"]), min_df=2)
    tm = BERTopic(
        embedding_model=model,
        umap_model=UMAP(n_neighbors=PARAMS["umap_neighbors"], n_components=PARAMS["umap_components"], min_dist=0.0,
                        metric="cosine", random_state=seed),
        hdbscan_model=HDBSCAN(min_cluster_size=PARAMS["hdbscan_min_cluster"],
                              min_samples=PARAMS["hdbscan_min_samples"], metric="euclidean",
                              cluster_selection_method=PARAMS["hdbscan_selection"], prediction_data=True),
        vectorizer_model=vectorizer, representation_model=KeyBERTInspired(), calculate_probabilities=True)
    topics, probs = tm.fit_transform(docs, emb)
    raw = list(topics)
    reassigned = tm.reduce_outliers(docs, topics, strategy=PARAMS["outlier_strategy"], embeddings=emb)
    tm.update_topics(docs, topics=reassigned, vectorizer_model=vectorizer, representation_model=KeyBERTInspired())
    return tm, raw, list(reassigned), probs


def stability(a, b):
    """Share of members whose topic in run b is the best match (by overlap) of their topic in run a."""
    pairs = defaultdict(Counter)
    for x, y in zip(a, b):
        pairs[x][y] += 1
    best = {x: c.most_common(1)[0][0] for x, c in pairs.items()}
    return sum(1 for x, y in zip(a, b) if best[x] == y) / len(a)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", action="append", default=[])
    ap.add_argument("--sample")
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--seed2", type=int, default=7)
    args = ap.parse_args()

    if args.sample:
        corpora, members = load_sample(args.sample)
        fetched_at = None
    else:
        corpora, members = [], []
        for path in args.corpus:
            meta, ms = load_corpus(path)
            corpora.append(meta)
            members += ms
        fetch_texts(members)
        fetched_at = dt.datetime.now(dt.timezone.utc).isoformat()

    for m in members:
        m["textUsed"] = "abstract" if len((m.get("abstract") or "").split()) >= 40 else (
            "title-only" if m["title"] else "none")
    usable = [m for m in members if m["textUsed"] != "none"]
    docs = [f"{m['title']}. {m.get('abstract') or ''}".strip() for m in usable]

    t0 = time.perf_counter()
    model = SentenceTransformer(MODEL)
    emb = model.encode(docs, batch_size=32, show_progress_bar=False)
    tm, raw, topics, probs = fit(docs, emb, args.seed, model)
    _, _, topics2, _ = fit(docs, emb, args.seed2, model)
    keys = KeyBERT(model=model).extract_keywords(
        docs, keyphrase_ngram_range=(1, PARAMS["keybert_ngram_max"]),
        stop_words=list(ENGLISH_STOP_WORDS | DOMAIN_STOP), use_mmr=True, diversity=0.5,
        top_n=PARAMS["keybert_top_n"], doc_embeddings=emb)
    elapsed = time.perf_counter() - t0

    out_members = []
    for i, m in enumerate(usable):
        p = float(probs[i].max()) if probs is not None and len(probs[i]) else None
        weak = raw[i] == -1 or (p is not None and p < PARAMS["weak_probability"])
        out_members.append({"corpusId": m["corpusId"], "memberId": m["memberId"], "topicId": int(topics[i]),
                            "probability": p, "weak": bool(weak), "keyphrases": [k for k, _ in keys[i]][:8],
                            "textUsed": m["textUsed"]})
    for m in members:
        if m["textUsed"] == "none":
            out_members.append({"corpusId": m["corpusId"], "memberId": m["memberId"], "topicId": -1,
                                "probability": None, "weak": True, "keyphrases": [], "textUsed": "none"})

    out_topics = []
    for tid in sorted(set(topics)):
        if tid == -1:
            continue
        idx = [i for i, t in enumerate(topics) if t == tid]
        ranked = sorted(idx, key=lambda i: -(float(probs[i].max()) if len(probs[i]) else 0))
        out_topics.append({
            "topicId": int(tid), "size": len(idx),
            "byCorpus": dict(Counter(usable[i]["corpusId"] for i in idx)),
            "words": [w for w, _ in (tm.get_topic(tid) or [])][:10],
            "representativeMemberIds": [usable[i]["memberId"] for i in ranked[:5]],
            "openalexSubfields": [{"name": n, "count": c} for n, c in
                                  Counter(usable[i].get("oa_subfield") for i in idx if usable[i].get("oa_subfield")).most_common(3)],
        })

    labelled = [i for i, m in enumerate(usable) if m.get("oa_subfield")]
    quality = {"outlierShare": round(sum(1 for t in raw if t == -1) / len(raw), 3),
               "stability": {"comparedSeed": args.seed2, "matchedTopicShare": round(stability(topics, topics2), 3)}}
    if labelled:
        quality["nmiVsOpenalexSubfield"] = round(normalized_mutual_info_score(
            [usable[i]["oa_subfield"] for i in labelled], [topics[i] for i in labelled]), 3)

    snapshot = {
        "format": "paperlab-corpus-topics", "schemaVersion": 1, "snapshotId": str(uuid.uuid4()),
        "createdAt": dt.datetime.now(dt.timezone.utc).isoformat(), "corpora": corpora,
        "pipeline": {"tag": f"bertopic-{_bt.__version__}+keybert-{_kb.__version__}", "embeddingModel": MODEL,
                     "parameters": PARAMS, "seed": args.seed, "textSource": "abstract",
                     **({"openalexFetchedAt": fetched_at} if fetched_at else {})},
        "quality": quality, "topics": out_topics, "members": out_members,
    }
    json.dump(snapshot, open(args.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"{len(usable)} members, {len(out_topics)} topics, quality {quality}, {elapsed:.0f}s")
    for t in out_topics:
        print(f"T{t['topicId']:>2} n={t['size']:>3} {t['byCorpus']} | {', '.join(t['words'][:6])}")


if __name__ == "__main__":
    main()
