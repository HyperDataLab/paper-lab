# Topics worker

## Build on Cloudflare (Workers Builds)

Set the root directory to `topics-worker/`, build command to `npm ci`, deploy command to
`npx wrangler deploy`, and production branch to `deploy/topics-worker`. The owner controls deployments
by updating that branch explicitly.

## spaCy parse service (`POST /nlp/parse`, slice P6)

The same Worker front, behind the same Firebase sign-in (`@hyperdatalab.org`, `ALLOWED_ORIGINS` CORS), forwards
`POST /nlp/parse` to a second container, `NlpContainer`, built from `nlp/Dockerfile`. That image holds only spaCy
3.8.7 and the pinned `en_core_web_sm` 3.8.0 wheel, both installed at build time with nothing downloaded at runtime.
It has no torch or BERTopic, so it should be much smaller and faster to start than the topics image (not measured
yet), and a parse never wakes the topics container.

Request (at most 200 sentences and 100 KB; the Worker checks both before it wakes the container):

```json
{ "sentences": [{ "key": "s1", "text": "The samples were analysed by two raters." }] }
```

Response:

```json
{
  "model": "en_core_web_sm",
  "modelVersion": "3.8.0",
  "spacyVersion": "3.8.7",
  "version": "pl-nlp-1",
  "sentences": [
    {
      "key": "s1",
      "tokens": [
        {
          "i": 0,
          "text": "The",
          "start": 0,
          "end": 3,
          "lemma": "the",
          "pos": "DET",
          "tag": "DT",
          "dep": "det",
          "head": 1,
          "morph": "Definite=Def|PronType=Art"
        }
      ],
      "root": 3,
      "voice": "passive",
      "tense": "past",
      "modal": null
    }
  ]
}
```

Token offsets are code points within the sent text. `voice` and `tense` describe the main clause; the rules,
and how they treat edge cases, are documented in `nlp/syntax.py`. Bump `SERVICE_VERSION` there whenever a rule
changes.

Status codes:

| Code | Meaning                                                                |
| ---- | ---------------------------------------------------------------------- |
| 400  | Invalid batch                                                          |
| 401  | Not signed in                                                          |
| 403  | Signed in, but not with a lab account                                  |
| 413  | Request too large                                                      |
| 503  | Container still starting (sent with `Retry-After`; the client retries) |

Tests:

- `nlp/test_syntax.py` runs the rules on hand-built parses and needs no model:
  `python test_syntax.py` or `pytest`.
- `nlp/test_syntax_model.py` runs on the real model and is skipped when spaCy is not installed.
- The GitHub deploy workflow runs both before `wrangler deploy`.

### Deploying (owner)

1. Merge to `main`, then update `deploy/topics-worker` ("Deploy now"). `wrangler deploy` builds both images,
   applies migration `v2` and creates the `NlpContainer` Durable Object class. The GitHub deploy workflow also runs
   the tests first. No new secret is needed: the deploy uses the existing `CLOUDFLARE_API_TOKEN` and the same
   `FIREBASE_PROJECT_ID`, `ALLOWED_DOMAIN` and `ALLOWED_ORIGINS` vars.
2. Check the route: an unsigned `POST https://paperlab-topics-worker.hyperdatalab.workers.dev/nlp/parse` should
   answer 401. The workflow's health step prints this.
3. Once a screen uses it (P6 only adds the provider and the measures; nothing in the UI calls
   `spacySyntaxProviderFromEnv` / `nlpClientFromEnv` yet), set
   `VITE_NLP_URL=https://paperlab-topics-worker.hyperdatalab.workers.dev` for the build, for example in
   `.env.production.local` or the hosting build environment, then deploy Hosting. While it is unset, the app has no
   spaCy provider.
