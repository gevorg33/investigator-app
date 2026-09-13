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
FROM pgvector/pgvector:pg17

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
         postgresql-17-postgis-3 \
         postgresql-17-postgis-3-scripts \
    && rm -rf /var/lib/apt/lists/*
