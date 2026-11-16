import unittest
from job_helpers import execute_job


class JobHelpersTest(unittest.TestCase):
    def test_progress_and_error(self):
        job = {}
        def run(payload, progress):
            progress("embedding")
            self.assertEqual(job["progress"], "embedding")
            raise ValueError("broken")
        execute_job(job, {}, run, lambda result: None)
        self.assertEqual(job["state"], "failed")
        self.assertIn("ValueError: broken", job["error"])
        self.assertIn("Traceback", job["error"])

    def test_completion(self):
        job = {}
        execute_job(job, {}, lambda payload, progress: {"ok": True}, lambda result: None)
        self.assertEqual(job["state"], "done")
        self.assertEqual(job["result"], {"ok": True})


if __name__ == "__main__":
    unittest.main()
