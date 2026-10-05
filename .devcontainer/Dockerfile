FROM mcr.microsoft.com/devcontainers/go:1-1.22-bookworm

# Drop the Yarn APT repo shipped by the base image (unused, and its GPG key is missing)
RUN rm -f /etc/apt/sources.list.d/yarn.list

# Install core utilities
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends \
    ripgrep \
    fd-find \
    jq \
    curl \
    unzip \
    ca-certificates \
    && ln -sf /usr/bin/fdfind /usr/local/bin/fd \
    && apt-get clean -y && rm -rf /var/lib/apt/lists/*

# Install the RTK binary globally into /usr/local/bin
RUN curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh \
    && mv /root/.local/bin/rtk /usr/local/bin/rtk