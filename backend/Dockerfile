FROM python:3.12-slim-bookworm

# uv replaces Poetry: single static binary, much faster, installs from uv.lock
COPY --from=ghcr.io/astral-sh/uv:0.11.17 /uv /uvx /bin/

WORKDIR /app

# Install into the system interpreter so console scripts (uvicorn, playwright)
# land on PATH without needing to activate a virtualenv.
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/usr/local

# Copy only the manifests first so dependency layers stay cached.
COPY pyproject.toml uv.lock /app/

RUN uv sync --frozen --no-dev

# Chromium powers the optional screenshot-preview tool and adds ~1.5GB.
# Build with --build-arg INSTALL_CHROMIUM=false for a slim image on
# memory-constrained hosts; the app degrades gracefully without it.
ARG INSTALL_CHROMIUM=true
RUN if [ "$INSTALL_CHROMIUM" = "true" ]; then \
        playwright install --with-deps chromium; \
    fi

# Copy the current directory contents into the container at /app
COPY ./ /app/
