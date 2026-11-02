FROM python:3.10-slim
ARG OPENTRONS_VERSION=9.0.0
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/tmp \
    OT_API_CONFIG_DIR=/tmp/opentrons-config
RUN pip install --no-cache-dir "opentrons==${OPENTRONS_VERSION}"
WORKDIR /app
COPY runner.py /app/runner.py
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin simulator
USER 10001:10001
ENTRYPOINT ["python", "/app/runner.py"]
