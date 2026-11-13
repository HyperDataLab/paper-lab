"""Compute corpus topics inside the Cloudflare container."""
import argparse
import datetime as dt
import json
import time
import urllib.parse
import urllib.request
import urllib.error
from helpers import abstract_of, stability, map_members
import uuid
from collections import Counter, defaultdict

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
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.load(resp)["results"]
        except urllib.error.HTTPError as error:
            if error.code != 429 and error.code < 500:
                raise
            if attempt == 4:
                raise
            time.sleep(2 ** attempt)



def fetch_texts(members):
    by_oa = defaultdict(list)
    for m in members:
        if m["openalexId"]:
            by_oa[m["openalexId"]].append(m)
    keys = list(by_oa)
    for i in range(0, len(keys), 50):
        chunk = keys[i:i + 50]
        for w in openalex({"filter": "openalex_id:" + "|".join(chunk), "per-page": "50",
                           "select": "id,title,abstract_inverted_index,primary_topic"}):
            for m in by_oa.get(w["id"].rsplit("/", 1)[-1], []):
                m["abstract"] = abstract_of(w.get("abstract_inverted_index"))
                m["title"] = m["title"] or (w.get("title") or "")
                m["oa_subfield"] = ((w.get("primary_topic") or {}).get("subfield") or {}).get("display_name")
        time.sleep(0.2)


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


def run(payload, progress=lambda text: None):
    corpora = payload["corpora"]
    members = map_members(payload["members"])
    args = argparse.Namespace(seed=42, seed2=7)
    progress("Fetching OpenAlex abstracts")
    fetch_texts(members)
    fetched_at = dt.datetime.now(dt.timezone.utc).isoformat()

    for m in members:
        m["textUsed"] = "abstract" if len((m.get("abstract") or "").split()) >= 40 else (
            "title-only" if m["title"] else "none")
    usable = [m for m in members if m["textUsed"] != "none"]
    docs = [f"{m['title']}. {m.get('abstract') or ''}".strip() for m in usable]

    t0 = time.perf_counter()
    progress("Embedding documents")
    model = SentenceTransformer(MODEL)
    emb = model.encode(docs, batch_size=32, show_progress_bar=False)
    progress("Clustering topics")
    tm, raw, topics, probs = fit(docs, emb, args.seed, model)
    progress("Checking stability")
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
    return snapshot
