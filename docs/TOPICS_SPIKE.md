# Corpus topics: BERTopic + KeyBERT spike

Date: 2026-11-13. Owner's choice: BERTopic for corpus topics plus KeyBERT for each paper's own keyphrases (Saffron was
evaluated and set aside: unmaintained since 2022, English-only, no per-paper topics, hard to host).

T1 reads externally produced `corpus-topics-v1` snapshots from the authenticated worker at
`paperlab/corpora-topics/<corpus-id>.json`. The maintainer uploads the same snapshot under each covered corpus ID.
The browser keeps snapshots and its own AI name candidates and edits locally; clustering does not run in PaperLab.

## Setup

- Data: a seeded OpenAlex sample (seed 2026) of open, published research articles 2020–2025 with abstracts: 150 from
  Expert Systems with Applications (S13144211) and 150 from Knowledge-Based Systems (S10169007), the planned
  ESWA target and control. Title + abstract per paper. Nothing from the papers is committed; only counts and topic
  words appear below.
- One embedding per paper with `all-MiniLM-L6-v2`, shared by both tools.
- BERTopic 0.17.4: UMAP (5 dims, cosine) → HDBSCAN (`leaf`, min cluster 6, min samples 3) → topic words with
  `KeyBERTInspired`.
- KeyBERT 0.9.0: 1–2-word phrases, MMR (diversity 0.5), 5 per paper.
- CPU only (laptop), Python 3.12, torch 2.15 CPU.

## Results

| Step                            | Time (300 papers, CPU) |
| ------------------------------- | ---------------------- |
| Embeddings                      | 21 s                   |
| BERTopic (UMAP, HDBSCAN, words) | 25 s                   |
| KeyBERT, 5 phrases per paper    | 92 s                   |

- With HDBSCAN's default `eom` selection and min cluster 8, one topic took 249 of 300 papers (NMI 0.16 against
  OpenAlex subfields). `leaf` selection with smaller clusters gave **16 topics, 61 outliers (20 %), NMI 0.51**.
- Topics where the journals differ (ESWA / KBS papers):

| Topic words (KeyBERT-inspired)                 | ESWA | KBS | Main OpenAlex subfield                     |
| ---------------------------------------------- | ---- | --- | ------------------------------------------ |
| validation, fuzzy, decision support, criteria  | 16   | 4   | Management Science and Operations Research |
| hybrid deep learning, learning model, features | 9    | 2   | Management Science and Operations Research |
| data driven, knowledge data driven, autonomous | 6    | 1   | Control and Systems Engineering            |
| feature extraction, anomaly detection          | 9    | 4   | Information Systems                        |
| datasets, feature, supervised learning         | 6    | 21  | Artificial Intelligence                    |
| SVM, self-supervised, classifiers              | 4    | 12  | Artificial Intelligence                    |
| graph attention, recommender, embeddings       | 5    | 9   | Information Systems                        |
| explainable AI (XAI), AI systems               | 6    | 9   | Artificial Intelligence                    |

- Per paper, KeyBERT phrases are specific and readable (e.g. "protection relays", "knowledge graph embeddings",
  "fact checking") while topic words stay generic ("deep learning, classification") — typical for abstracts in one
  broad field.

## What it means for PaperLab

- **By corpus:** BERTopic gives a usable topic map in under a minute on CPU for 300 papers, and shows where a target
  journal differs from its control (fuzzy decision support and hybrid models lean ESWA; supervised/self-supervised
  method papers lean KBS).
- **By paper:** "topic X of the corpus (probability), own keyphrases (KeyBERT), nearest papers in the topic".
- **Needed before use:**
  1. Topic names: one LLM call per topic over its words and 3–5 representative titles (~16 calls), shown as
     candidates the user can rename.
  2. Outliers: assign with `reduce_outliers` (embeddings strategy), then assess weak assignments using cosine fit
     to final-topic centroids. A member is weak if another centroid is closer, its fit is below the global 10th
     percentile (linearly interpolated), or it remains unassigned. Original outlier status alone does not mark it weak.
  3. Domain stop words ("model", "data", "learning", "deep learning", "classification") so topic words separate.
  4. Stability: fixed seeds; compare two runs and report topics that move.
  5. Scale: full text or larger corpora (1,749 open ESWA papers) need the container; KeyBERT is the slow part
     (~0.3 s per abstract on CPU) and can use a candidate-phrase vectoriser.
- **Where it runs:** a Python container on Cloudflare (like GROBID): embeddings + BERTopic + KeyBERT for a corpus, cached
  in R2 by corpus release id; the browser shows the map, the per-paper card and the ESWA/KBS comparison. OpenAlex
  Topics stay as the reference taxonomy for comparison (NMI is reported per run).
