import unittest

from validation import build_topic_vectorizer


class TopicVectorizerTest(unittest.TestCase):
    def test_relaxes_min_df_for_sparse_titles(self):
        docs = ["quantum", "federated", "asynchronous", "privacy", "network", "robust"]
        vectorizer = build_topic_vectorizer(docs, 3, {"quantum", "federated", "asynchronous"})
        self.assertEqual(vectorizer.min_df, 1)
        self.assertTrue(vectorizer.vocabulary_)

    def test_removes_stopwords_only_when_needed_to_find_terms(self):
        docs = ["the and", "of the"]
        vectorizer = build_topic_vectorizer(docs, 2, {"the", "and", "of"})
        self.assertIsNone(vectorizer.stop_words)
        self.assertTrue(vectorizer.vocabulary_)

    def test_reports_documents_without_indexable_terms(self):
        with self.assertRaisesRegex(ValueError, "No usable terms"):
            build_topic_vectorizer(["!!!", "???"], 2, set())


if __name__ == "__main__":
    unittest.main()
