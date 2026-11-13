"""BERTopic + KeyBERT spike on a JSONL corpus (one paper per line: journal, title, abstract, oa_subfield, ...).

Usage: python topic_spike.py <in.jsonl> <out_dir>
Writes out_dir/topics.json, out_dir/papers.json and prints a short summary (no abstracts).
"""
import json
import os
import sys
import time
from collections import Counter

from bertopic import BERTopic
from bertopic.representation import KeyBERTInspired
from hdbscan import HDBSCAN
from keybert import KeyBERT
from sentence_transformers import SentenceTransformer
from sklearn.feature_extraction.text import CountVectorizer
from sklearn.metrics import normalized_mutual_info_score
from umap import UMAP

MODEL = "sentence-transformers/all-MiniLM-L6-v2"


def main(src, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    papers = [json.loads(line) for line in open(src, encoding="utf-8")]
    docs = [f"{p['title']}. {p['abstract']}" for p in papers]
    t = {}

    t0 = time.perf_counter()
    model = SentenceTransformer(MODEL)
    t["load_model_s"] = time.perf_counter() - t0

    t0 = time.perf_counter()
    emb = model.encode(docs, batch_size=32, show_progress_bar=False)
    t["embed_s"] = time.perf_counter() - t0

    t0 = time.perf_counter()
    topic_model = BERTopic(
        embedding_model=model,
        umap_model=UMAP(n_neighbors=15, n_components=5, min_dist=0.0, metric="cosine", random_state=42),
        hdbscan_model=HDBSCAN(min_cluster_size=int(os.environ.get("MCS", "6")), min_samples=int(os.environ.get("MS", "3")), metric="euclidean", cluster_selection_method=os.environ.get("CSM", "leaf"), prediction_data=True),
        vectorizer_model=CountVectorizer(stop_words="english", ngram_range=(1, 3), min_df=2),
        representation_model=KeyBERTInspired(),
        calculate_probabilities=True,
    )
    topics, probs = topic_model.fit_transform(docs, emb)
    t["bertopic_s"] = time.perf_counter() - t0

    t0 = time.perf_counter()
    kw = KeyBERT(model=model)
    keys = kw.extract_keywords(
        docs, keyphrase_ngram_range=(1, 2), stop_words="english", use_mmr=True, diversity=0.5, top_n=5, doc_embeddings=emb
    )
    t["keybert_s"] = time.perf_counter() - t0

    info = topic_model.get_topic_info()
    out_topics = []
    for _, row in info.iterrows():
        tid = int(row["Topic"])
        members = [i for i, x in enumerate(topics) if x == tid]
        journals = Counter(papers[i]["journal"] for i in members)
        subfields = Counter(papers[i]["oa_subfield"] for i in members).most_common(2)
        out_topics.append(
            {
                "topic": tid,
                "size": len(members),
                "eswa": journals.get("ESWA", 0),
                "kbs": journals.get("KBS", 0),
                "words": [w for w, _ in (topic_model.get_topic(tid) or [])][:8],
                "top_openalex_subfields": subfields,
            }
        )
    out_papers = []
    for i, p in enumerate(papers):
        prob = float(probs[i].max()) if probs is not None and len(probs[i]) else None
        out_papers.append(
            {
                "doi": p["doi"],
                "journal": p["journal"],
                "topic": int(topics[i]),
                "topic_prob": prob,
                "keybert": [k for k, _ in keys[i]],
                "oa_topic": p["oa_topic"],
                "oa_subfield": p["oa_subfield"],
            }
        )
    clustered = [i for i, x in enumerate(topics) if x != -1]
    nmi = normalized_mutual_info_score(
        [papers[i]["oa_subfield"] or "" for i in clustered], [topics[i] for i in clustered]
    )
    json.dump(out_topics, open(os.path.join(out_dir, "topics.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump(out_papers, open(os.path.join(out_dir, "papers.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    print("timing_s", {k: round(v, 1) for k, v in t.items()})
    print("papers", len(papers), "topics", len([x for x in out_topics if x["topic"] != -1]),
          "outliers", sum(1 for x in topics if x == -1), "NMI_vs_openalex_subfield", round(nmi, 3))
    for x in out_topics:
        print(f"T{x['topic']:>2} n={x['size']:>3} ESWA={x['eswa']:>3} KBS={x['kbs']:>3} | {', '.join(x['words'][:6])} | OA: {x['top_openalex_subfields'][:1]}")
    for p in out_papers[:3] + out_papers[150:153]:
        print("paper", p["journal"], "T", p["topic"], round(p["topic_prob"] or 0, 2), "|", "; ".join(p["keybert"][:5]))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
