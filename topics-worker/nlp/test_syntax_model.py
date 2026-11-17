"""Voice/tense on real en_core_web_sm parses. Skipped when spaCy or the model is not installed (local machines);
CI installs both from nlp/requirements.txt. Run: python test_syntax_model.py (or pytest)."""

import unittest

from syntax import describe, doc_tokens

try:
    import spacy

    nlp = spacy.load("en_core_web_sm", exclude=["ner"])
except (ImportError, OSError):
    nlp = None

CASES = [
    ("We measured the growth rate.", "active", "past"),
    ("The samples were analysed by two raters.", "passive", "past"),
    ("Results are reported in Table 2.", "passive", "present"),
    ("We will report the results in a later study.", "active", "future"),
    ("The method can be applied to other corpora.", "passive", "none"),
    ("Were the samples analysed twice?", "passive", "past"),
    ("Does the method work on short texts?", "active", "present"),
    ("This model has been trained on news articles.", "passive", "present"),
]


@unittest.skipIf(nlp is None, "spaCy / en_core_web_sm not installed")
class ModelTest(unittest.TestCase):
    def test_cases(self):
        for text, expected_voice, expected_tense in CASES:
            with self.subTest(text=text):
                value = describe(doc_tokens(nlp(text)))
                self.assertEqual((value["voice"], value["tense"]), (expected_voice, expected_tense))


if __name__ == "__main__":
    unittest.main()
