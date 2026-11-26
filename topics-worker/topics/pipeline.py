"""Compute corpus topics inside the Cloudflare container."""
import argparse
import datetime as dt
import time
from abstracts import fetch_texts
from helpers import stability, map_members, percentile, top_subfields, topic_fit
from validation import build_topic_vectorizer, validate_usable_members
import uuid
from collections import Counter

from bertopic import BERTopic
from bertopic.representation import KeyBERTInspired
from hdbscan import HDBSCAN
from keybert import KeyBERT
from sentence_transformers import SentenceTransformer
from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS
from sklearn.metrics import normalized_mutual_info_score
from umap import UMAP

import bertopic as _bt
import keybert as _kb

def utc_now():
    """ISO 8601 in UTC ending in Z, as corpus-topics-v1 (a Zod ISO datetime) requires; isoformat() gives +00:00."""
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


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
          "weak_fit_percentile": 0.10, "weak_method": "centroid-cosine", "outlier_strategy": "embeddings"}


def fit(docs, emb, seed, model, params):
    vectorizer = build_topic_vectorizer(docs, params["ngram_max"], DOMAIN_STOP)
    tm = BERTopic(
        embedding_model=model,
        umap_model=UMAP(n_neighbors=params["umap_neighbors"], n_components=params["umap_components"], min_dist=0.0,
                        metric="cosine", random_state=seed),
        hdbscan_model=HDBSCAN(min_cluster_size=params["hdbscan_min_cluster"],
                              min_samples=params["hdbscan_min_samples"], metric="euclidean",
                              cluster_selection_method=params["hdbscan_selection"], prediction_data=True),
        vectorizer_model=vectorizer, representation_model=KeyBERTInspired(), calculate_probabilities=True)
    topics, probs = tm.fit_transform(docs, emb)
    raw = list(topics)
    reassigned = tm.reduce_outliers(docs, topics, strategy=PARAMS["outlier_strategy"], embeddings=emb)
    tm.update_topics(docs, topics=reassigned, vectorizer_model=vectorizer, representation_model=KeyBERTInspired())
    return tm, raw, list(reassigned), probs


def run(payload, progress=lambda text: print(text, flush=True)):
    corpora = payload["corpora"]
    members = map_members(payload["members"])
    args = argparse.Namespace(seed=42, seed2=7)
    fetch_texts(members, progress)
    fetched_at = utc_now()

    for m in members:
        m["textUsed"] = "abstract" if len((m.get("abstract") or "").split()) >= 40 else (
            "title-only" if m["title"] else "none")
    usable = [m for m in members if m["textUsed"] != "none"]
    usable = validate_usable_members(usable, PARAMS["hdbscan_min_cluster"])
    docs = [f"{m['title']}. {m.get('abstract') or ''}".strip() if m["textUsed"] == "abstract"
            else m["title"] for m in usable]

    # Small corpora need a lower UMAP neighbourhood and embedding dimension; fixed defaults
    # make UMAP's spectral initialisation fail when there are only a few usable papers.
    params = {
        **PARAMS,
        "umap_neighbors": min(PARAMS["umap_neighbors"], len(docs) - 1),
        "umap_components": min(PARAMS["umap_components"], len(docs) - 2),
        "hdbscan_min_cluster": min(PARAMS["hdbscan_min_cluster"], len(docs)),
        "hdbscan_min_samples": min(PARAMS["hdbscan_min_samples"], len(docs) - 1),
    }

    t0 = time.perf_counter()
    progress("Embedding documents")
    model = SentenceTransformer(MODEL)
    emb = model.encode(docs, batch_size=32, show_progress_bar=False)
    progress("Clustering seed 42")
    tm, raw, topics, probs = fit(docs, emb, args.seed, model, params)
    progress("Clustering seed 7")
    _, _, topics2, _ = fit(docs, emb, args.seed2, model, params)
    progress("Keyphrases")
    keys = KeyBERT(model=model).extract_keywords(
        docs, keyphrase_ngram_range=(1, PARAMS["keybert_ngram_max"]),
        stop_words=list(ENGLISH_STOP_WORDS | DOMAIN_STOP), use_mmr=True, diversity=0.5,
        top_n=PARAMS["keybert_top_n"], doc_embeddings=emb)
    elapsed = time.perf_counter() - t0

    fits = topic_fit(emb, topics, PARAMS["weak_fit_percentile"])
    out_members = []
    for i, m in enumerate(usable):
        tid = int(topics[i])
        p = (max(0.0, min(1.0, float(probs[i][tid])))
             if probs is not None and getattr(probs, "ndim", 0) == 2 and tid >= 0 and tid < probs.shape[1]
             else None)
        out_members.append({"corpusId": m["corpusId"], "memberId": m["memberId"], "topicId": int(topics[i]),
                            "probability": p, "weak": bool(fits[i]["weak"]),
                            "fit": round(float(fits[i]["fit"]), 4) if fits[i]["fit"] is not None else None,
                            "weakReason": str(fits[i]["reason"]) if fits[i]["reason"] is not None else None,
                            "keyphrases": [k for k, _ in keys[i]][:8],
                            "textUsed": m["textUsed"]})
    for m in members:
        if m["textUsed"] == "none":
            out_members.append({"corpusId": m["corpusId"], "memberId": m["memberId"], "topicId": -1,
                                "probability": None, "weak": True, "fit": None, "weakReason": "unassigned",
                                "keyphrases": [], "textUsed": "none"})

    reasons = Counter(result["reason"] for result in fits if result["weak"])
    reasons["unassigned"] += sum(m["textUsed"] == "none" for m in members)
    fit_values = [result["fit"] for result in fits if result["fit"] is not None]
    p10 = percentile(fit_values, PARAMS["weak_fit_percentile"])
    median = percentile(fit_values, 0.5)
    show = lambda value: f"{value:.3f}" if value is not None else "n/a"
    progress(f"Weak: {sum(reasons.values())} (closer-to-other-topic {reasons['closer-to-other-topic']}, "
             f"low-fit {reasons['low-fit']}, unassigned {reasons['unassigned']}); "
             f"fit p10={show(p10)} median={show(median)}")

    out_topics = []
    for tid in sorted(set(topics)):
        if tid == -1:
            continue
        idx = [i for i, t in enumerate(topics) if t == tid]
        ranked = sorted(idx, key=lambda i: -fits[i]["fit"])
        out_topics.append({
            "topicId": int(tid), "size": len(idx),
            "byCorpus": dict(Counter(usable[i]["corpusId"] for i in idx)),
            "words": [w for w, _ in (tm.get_topic(tid) or [])][:10],
            "representativeMemberIds": [usable[i]["memberId"] for i in ranked[:5]],
            "openalexSubfields": top_subfields([usable[i] for i in idx]),
        })

    labelled = [i for i, m in enumerate(usable) if m.get("oa_subfield")]
    quality = {"outlierShare": round(sum(1 for t in raw if t == -1) / len(raw), 3),
               "stability": {"comparedSeed": args.seed2, "matchedTopicShare": round(stability(topics, topics2), 3)}}
    if labelled:
        quality["nmiVsOpenalexSubfield"] = round(normalized_mutual_info_score(
            [usable[i]["oa_subfield"] for i in labelled], [topics[i] for i in labelled]), 3)

    snapshot = {
        "format": "paperlab-corpus-topics", "schemaVersion": 1, "snapshotId": str(uuid.uuid4()),
        "createdAt": utc_now(), "corpora": corpora,
        "pipeline": {"tag": f"bertopic-{_bt.__version__}+keybert-{_kb.__version__}", "embeddingModel": MODEL,
        "parameters": params, "seed": args.seed, "textSource": "abstract",
                     **({"openalexFetchedAt": fetched_at} if fetched_at else {})},
        "quality": quality, "topics": out_topics, "members": out_members,
    }
    return snapshot
