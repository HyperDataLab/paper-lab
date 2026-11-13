FROM python:3.12-slim
WORKDIR /app
COPY topics/requirements.txt .
RUN pip install --no-cache-dir torch==2.15.0 --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt jsonschema==4.25.1
ENV HF_HOME=/app/model HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
RUN HF_HUB_OFFLINE=0 TRANSFORMERS_OFFLINE=0 python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')" \
    && useradd --create-home --uid 10001 app
COPY topics/ /app/
USER app
EXPOSE 8080
CMD ["python", "app.py"]
