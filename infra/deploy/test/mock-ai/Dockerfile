FROM python:3.12.15-slim
ARG SHA
ARG MODE=ok
ENV MOCK_SHA=$SHA MOCK_MODE=$MODE
COPY mock_ai.py /app/mock_ai.py
CMD ["python", "/app/mock_ai.py"]
