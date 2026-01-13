---
sidebar_position: 1
---

# Installation

## Prerequisites

- **PostgreSQL** 14 or higher
- **Node.js** 18+ or **Bun** runtime
- **Docker** (optional, for local development)

## Install the Package

```bash
# Using bun
bun add p9s

# Using npm
npm install p9s

# Using yarn
yarn add p9s
```

## Development Setup

For local development with Docker:

```bash
# Install Docker
brew install --cask docker

# Clone the repository
git clone https://github.com/crubier/pg-permission-tree.git
cd pg-permission-tree

# Install dependencies
bun install

# Start the database
bun run db-start

# Run tests
bun test
```

## Project Structure

The monorepo contains:

- `packages/core` - Core library with configuration types and validation
- `examples/` - Example implementations
- `benchmarks/` - Performance benchmarks
