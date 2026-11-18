# spaCy parse service (POST /nlp/parse): no torch, no BERTopic, so the image stays small and starts in seconds.
FROM python:3.12-slim
WORKDIR /app
COPY nlp/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && python -c "import spacy; spacy.load('en_core_web_sm', exclude=['ner'])" \
    && useradd --create-home --uid 10001 app
COPY nlp/ /app/
USER app
EXPOSE 8080
CMD ["python", "app.py"]
