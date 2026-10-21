FROM python:3.12.15-slim
ARG SHA
ARG MODE=ok
ENV MOCK_SHA=$SHA MOCK_MODE=$MODE
COPY mock_be.py /app/mock_be.py
CMD ["python", "/app/mock_be.py"]
