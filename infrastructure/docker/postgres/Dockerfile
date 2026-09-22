# PostgreSQL with BOTH pgvector and PostGIS.
#
# No official image ships both. This platform needs PostGIS for investigator
# discovery (postgis-search) and pgvector for permission-aware RAG (ADR-0001).
#
# Built FROM pgvector rather than postgis, for one concrete reason:
# postgis/postgis publishes linux/amd64 only, so it does not run natively on Apple
# Silicon — verified with `docker manifest inspect`. pgvector/pgvector publishes
# amd64 and arm64, and PostGIS installs cleanly from the PGDG apt repository that
# the official postgres base already trusts.
# Pinned by digest, and the same digest CI runs its service from (T-028).
FROM pgvector/pgvector:pg17@sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f

# `upgrade` first: the base is rebuilt upstream less often than Debian ships fixes, and the image
# scan in CI blocks on any CRITICAL or HIGH with a fix available (T-028). This is that fix.
RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && apt-get install -y --no-install-recommends \
         postgresql-17-postgis-3 \
         postgresql-17-postgis-3-scripts \
    && rm -rf /var/lib/apt/lists/*
