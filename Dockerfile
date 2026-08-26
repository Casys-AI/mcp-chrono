# syntax=docker/dockerfile:1.7
# linux/amd64 is intentional: this release image is a fixed native-engine target.
FROM --platform=linux/amd64 denoland/deno:bin-2.9.2@sha256:5ab209e42a062db554ebc7598409b4a43467d7911e2cdee6176a0b4efc67738f AS deno
FROM --platform=linux/amd64 mambaorg/micromamba@sha256:2681c45bf145f9b292fc26120646125586a2be4289eda48ce8a94ae2b22eda67

LABEL org.opencontainers.image.title="Casys MCP Chrono" \
      org.opencontainers.image.description="Authenticated Project Chrono prescribed-kinematics MCP provider" \
      org.opencontainers.image.source="https://github.com/Casys-AI/mcp-chrono" \
      org.opencontainers.image.licenses="NOASSERTION" \
      org.opencontainers.image.vendor="Casys"

USER root
ENV MAMBA_ROOT_PREFIX=/opt/conda \
    PATH=/opt/conda/bin:/usr/local/bin:$PATH \
    DENO_DIR=/opt/deno \
    CHRONO_STORE_DIR=/data \
    CHRONO_PYTHON=/opt/conda/bin/python \
    PYTHONDONTWRITEBYTECODE=1 \
    HOST=0.0.0.0 \
    PORT=3025 \
    CHRONO_INTERNAL_PORT=3026
COPY --from=deno /deno /usr/local/bin/deno
WORKDIR /app
COPY deno.json deno.lock mod.ts server.ts LICENSE THIRD_PARTY_NOTICES.md ./
COPY locks ./locks
COPY src ./src
COPY scripts ./scripts
RUN micromamba install --yes --name base --file /app/locks/pychrono-linux-64.explicit.txt \
 && "$CHRONO_PYTHON" -c 'import json; import pychrono.core as chrono; metadata = json.load(open("/opt/conda/conda-meta/pychrono-10.0.0-py312h98ab86c_677.json", encoding="utf-8")); assert metadata["name"] == "pychrono"; assert metadata["version"] == "10.0.0"; assert metadata["build"] == "py312h98ab86c_677"; assert all(hasattr(chrono, name) for name in ("ChSystemNSC", "ChLinkMotorRotationAngle", "ChFunctionRamp", "ChFramed", "VNULL")); motor = chrono.ChLinkMotorRotationAngle(); assert all(hasattr(motor, name) for name in ("Initialize", "SetAngleFunction", "GetMotorAngle", "GetConstraintViolation"))' \
 && deno cache --frozen --node-modules-dir=none server.ts \
 && micromamba clean --all --yes \
 && mkdir -p /data /opt/deno \
 && chown -R mambauser:mambauser /app /data /opt/deno

USER mambauser
VOLUME ["/data"]
EXPOSE 3025
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["python", "-c", "import os, urllib.request; token = os.environ.get('MCP_BEARER_TOKEN'); assert token; request = urllib.request.Request('http://127.0.0.1:3025/healthz', headers={'Authorization': 'Bearer ' + token}); urllib.request.urlopen(request, timeout=3).read()"]
ENTRYPOINT ["python", "/app/scripts/container_entrypoint.py"]
