---
sidebar_position: 1
---

# Introduction

**p9s** (pg-permission-tree) is a high-performance, hierarchical permissions system for PostgreSQL-based applications. It provides row-level security with transitive permission computation through tree-structured resources and roles.

## Overview

This library implements a generic, yet performant, permissions system with the following key concepts:

### Resources

Resources represent business-domain objects. They are nodes in a tree structure:

- **Leaf nodes**: files, documents, most business domain objects
- **Parent nodes**: folders, projects, workspaces (can have children)

### Roles

Roles represent entities that can access resources. They are also nodes in a tree:

- **Leaf nodes**: users, API tokens
- **Parent nodes**: user groups, organizations

### Flexibility

Both trees are actually directed acyclic graphs (DAGs), since each node can have multiple parents (e.g., symlinks, shared folders). The system performs best when the DAG resembles a tree structure.

### Assignments

Assignments link resources to roles, representing access grants (e.g., sharing a folder with a group).

### Permission Bitmap

Each edge in the graph has a `permission` field represented as a bitmap:

- One bit per permitted operation/permission class
- `1` = permission granted, `0` = permission denied
- Configurable bitmap size for desired granularity

### Permission Computation

Permissions are computed by considering all paths from a role node to a resource node:

- **Path permission**: Bitwise AND of all edge permissions in the path
- **Total permission**: Bitwise OR of all path permissions

This is implemented using cache tables and triggers for automatic updates.

### Row Level Security

The system generates PostgreSQL Row Level Security (RLS) policies to enforce permissions. Alternatively, it can integrate with GraphQL middleware or custom APIs.

## Quick Start

```bash
# Install dependencies
bun install

# Start the database
bun run db-start

# Run tests
bun test
```

## Next Steps

- [Installation](./getting-started/installation) - Set up p9s in your project
- [Configuration](./configuration/overview) - Learn about configuration options
- [Core Package](./packages/core) - API reference for the core package
