# Docker Install

## Pull

Pinned:

```bash
docker pull ghcr.io/talhas-laboratory/autology:1.0.0
```

Latest:

```bash
docker pull ghcr.io/talhas-laboratory/autology:latest
```

## Run Doctor

```bash
docker run --rm \
  -e NEO4J_URI=bolt://host.docker.internal:7687 \
  -e NEO4J_USER=neo4j \
  -e NEO4J_PASSWORD=autopology_dev_pw \
  -e NEO4J_DATABASE=neo4j \
  -v /path/to/repo:/workspace \
  ghcr.io/talhas-laboratory/autology:1.0.0 doctor --repo /workspace
```

## Compose

- Production-oriented example: `/Users/talhauddin/software/AuTopology/docker-compose.yml`
- Local dev example: `/Users/talhauddin/software/AuTopology/docker-compose.dev.yml`
