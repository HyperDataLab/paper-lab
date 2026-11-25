MIN_USABLE_PAPERS = 6


def validate_usable_members(members, minimum=MIN_USABLE_PAPERS):
    """Reject jobs before UMAP/HDBSCAN fail with an opaque error on too little usable text."""
    usable = [member for member in members if member.get("textUsed") != "none"]
    if len(usable) < minimum:
        raise ValueError(
            f"At least {minimum} papers need a title or abstract; "
            f"only {len(usable)} usable papers were found."
        )
    return usable


def build_topic_vectorizer(docs, ngram_max, domain_stop_words):
    """Relax vocabulary filtering when a small/sparse corpus has no repeated terms."""
    from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS, CountVectorizer

    options = (
        (list(ENGLISH_STOP_WORDS | domain_stop_words), 2),
        (list(ENGLISH_STOP_WORDS), 1),
        (None, 1),
    )
    for stop_words, min_df in options:
        vectorizer = CountVectorizer(stop_words=stop_words, ngram_range=(1, ngram_max), min_df=min_df)
        try:
            vectorizer.fit(docs)
            return vectorizer
        except ValueError as error:
            if "empty vocabulary" not in str(error).lower() and "no terms remain" not in str(error).lower():
                raise
    raise ValueError("No usable terms were found in the paper titles or abstracts.")
