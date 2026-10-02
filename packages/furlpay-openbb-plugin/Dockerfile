# syntax=docker/dockerfile:1

# Base pinned by digest, not by the mutable `python:3.12-slim` tag.
# `:3.12-slim` currently resolves to Debian 13 (trixie) — 23 known CVEs
# (0 critical / 0 high) vs 35 (1 high, gnupg2 CVE-2025-68973) on bookworm.
# Because the tag is mutable, a scanner keeps reporting whatever it last
# pulled; the digest makes the base we actually ship deterministic.
# Refresh with: docker buildx imagetools inspect python:3.12-slim-trixie
ARG PYTHON_BASE=python:3.12-slim-trixie@sha256:57cd7c3a7a273101a6485ba99423ee568157882804b1124b4dd04266317710de

FROM ${PYTHON_BASE} AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Build the dependency set inside a venv so the runtime stage can take the
# venv alone and leave pip/setuptools and the apt cache behind.
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"

# pip 25.0.1 as shipped in the base carries CVE-2025-8869 (tar symlink
# traversal on extraction); upgrade before installing anything.
RUN python -m pip install --upgrade pip setuptools wheel

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# The runtime stage copies this venv wholesale, so pip/setuptools/wheel inside
# it shipped too, and with them pip's VENDORED msgpack and urllib3. The
# 2026-10-01 container scan failed on exactly those: msgpack GHSA-6v7p-g79w-8964
# (HIGH), urllib3 CVE-2026-97687 and setuptools CVE-2025-47273, none of which the
# app imports. Nothing installs at runtime, so remove them from the venv here
# (the runtime stage's own uninstall only touches the system interpreter).
RUN python -m pip uninstall -y pip setuptools wheel


FROM ${PYTHON_BASE} AS runtime

# Pull OS security updates published since the base image was built. This is
# the lever that clears the bulk of the low-severity Debian package findings;
# the remainder are won't-fix upstream (e.g. CVE-2019-1010023 in glibc).
RUN apt-get update \
 && apt-get upgrade -y \
 && rm -rf /var/lib/apt/lists/*

# The app runs entirely from /opt/venv, so the interpreter's own pip and
# setuptools are dead weight and a standing CVE surface. Drop them.
RUN python -m pip uninstall -y pip setuptools wheel 2>/dev/null || true

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:${PATH}"

COPY --from=builder /opt/venv /opt/venv

# Non-root. Port is 7777 (>1024), so no privileged bind is needed.
RUN useradd --system --uid 10001 --create-home --shell /usr/sbin/nologin app

WORKDIR /app
COPY --chown=app:app . .

USER app

EXPOSE 7777

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:7777/', timeout=2).status == 200 else 1)"

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7777"]
