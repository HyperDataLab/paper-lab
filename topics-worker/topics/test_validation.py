import unittest

from validation import validate_usable_members


class TopicValidationTest(unittest.TestCase):
    def test_rejects_too_few_usable_documents(self):
        members = [{"textUsed": "title-only"}] * 5 + [{"textUsed": "none"}]
        with self.assertRaisesRegex(ValueError, "only 5 usable papers"):
            validate_usable_members(members)

    def test_accepts_six_usable_documents_and_ignores_unassigned(self):
        members = [{"textUsed": "abstract"}] * 4 + [{"textUsed": "title-only"}] * 2 + [{"textUsed": "none"}]
        self.assertEqual(len(validate_usable_members(members)), 6)


if __name__ == "__main__":
    unittest.main()
