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
COPY deno.json deno.lock mod.ts server.ts ./
COPY locks ./locks
COPY src ./src
COPY scripts ./scripts
RUN ! grep -E 'package=(cuda|cudnn|libcu|mkl|intel-mkl|mpi|openmpi|mpich|libgl|libegl|libopengl|opengl|xorg-|font-|fonts-|qt|vtk|irrlicht)' /app/locks/pychrono-linux-64.explicit.txt \
 && micromamba install --yes --name base --file /app/locks/pychrono-linux-64.explicit.txt \
 && "$CHRONO_PYTHON" -c 'import json; pychrono_metadata = json.load(open("/opt/conda/conda-meta/pychrono-10.0.0-py312h3a49c4c_0.json", encoding="utf-8")); chrono_metadata = json.load(open("/opt/conda/conda-meta/chrono-10.0.0-py312h14c7f5c_0.json", encoding="utf-8")); assert pychrono_metadata["name"] == "pychrono"; assert pychrono_metadata["version"] == "10.0.0"; assert pychrono_metadata["build"] == "py312h3a49c4c_0"; assert chrono_metadata["name"] == "chrono"; assert chrono_metadata["version"] == "10.0.0"; assert chrono_metadata["build"] == "py312h14c7f5c_0"' \
 && test -d /opt/conda/share/chrono/data \
 && test -d /opt/conda/lib/python3.12/site-packages/pychrono/demos \
 && rm -rf /opt/conda/share/chrono/data /opt/conda/lib/python3.12/site-packages/pychrono/demos \
 && find /opt/conda -type d -name __pycache__ -prune -exec rm -rf {} + \
 && "$CHRONO_PYTHON" /app/scripts/collect_conda_notices.py \
 && rm -rf /opt/conda/pkgs \
 && ! test -e /opt/conda/pkgs \
 && "$CHRONO_PYTHON" -c 'from pathlib import Path; import pychrono.core as chrono; import json; removed = (Path("/opt/conda/share/chrono/data"), Path("/opt/conda/lib/python3.12/site-packages/pychrono/demos")); conda_meta = Path("/opt/conda/conda-meta"); bundle = Path("/opt/conda/share/mcp-chrono/conda-notices"); manifest = json.loads((bundle / "manifest.json").read_text(encoding="utf-8")); assert all(not path.exists() for path in removed); assert not any(Path("/opt/conda").rglob("__pycache__")); assert (conda_meta / "chrono-10.0.0-py312h14c7f5c_0.json").is_file(); assert (conda_meta / "pychrono-10.0.0-py312h3a49c4c_0.json").is_file(); assert manifest["schema"] == "conda-notice-bundle/1.0"; assert manifest["packages"]; assert any(path.endswith("/info/index.json") for package in manifest["packages"] for path in package["files"]); assert all(hasattr(chrono, name) for name in ("ChSystemNSC", "ChLinkMotorRotationAngle", "ChFunctionRamp", "ChFramed", "VNULL")); motor = chrono.ChLinkMotorRotationAngle(); assert all(hasattr(motor, name) for name in ("Initialize", "SetAngleFunction", "GetMotorAngle", "GetConstraintViolation"))' \
 && deno cache --frozen --node-modules-dir=none server.ts \
 && mkdir -p /data /opt/deno \
 && chown -R mambauser:mambauser /app /data /opt/deno

COPY LICENSE THIRD_PARTY_NOTICES.md ./
COPY LICENSES /usr/share/licenses/mcp-chrono
RUN "$CHRONO_PYTHON" /app/scripts/verify_image_notices.py

USER mambauser
VOLUME ["/data"]
EXPOSE 3025
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["python", "-c", "import os, urllib.request; token = os.environ.get('MCP_BEARER_TOKEN'); assert token; request = urllib.request.Request('http://127.0.0.1:3025/healthz', headers={'Authorization': 'Bearer ' + token}); urllib.request.urlopen(request, timeout=3).read()"]
ENTRYPOINT ["python", "/app/scripts/container_entrypoint.py"]
