"""Record job progress without importing the machine-learning stack."""
import sys
import traceback


def execute_job(job, payload, run, validate):
    def progress(text):
        job.update(state="running", progress=text)
        print(text, flush=True)

    try:
        progress("Starting")
        result = run(payload, progress)
        progress("Validating")
        validate(result)
        job.update(state="done", progress="Complete", result=result)
        print("Complete", flush=True)
    except Exception as error:
        detail = "".join(traceback.format_exception(type(error), error, error.__traceback__)).strip()
        detail = "\n".join(detail.splitlines()[-12:])
        job.update(state="failed", progress="Failed", error=detail)
        print(detail, file=sys.stderr, flush=True)
