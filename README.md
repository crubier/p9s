# pg-permission-tree

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.0. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

# Postgres Permissions Deep (p9s)

## Overview

This is a proof of concept for a very generic, yet performant, permissions system for Postgres-based applications. Its key aspects are:

- **Resources:** `resources` represent business-domain objects. They are nodes in a tree. Some can be leaves of the tree (e.g. files, most business domain object) while some can have children (e.g. folders, projects, workspaces).
  ![resources](./docs/resources.png)
- **Roles:** `roles` represent the entities that can access `resources`. They are nodes in a tree. Some can be leaves of the tree (e.g. users, api tokens) while some can have children (e.g. user groups, organizations).
  ![roles](./docs/roles.png)
- **Flexibility:** As shown above, these trees are actually not strict, they are technically directed acyclic graphs (DAG), since each node can have multiple parents (e.g. symlinks in a file system, shared folders). The system is more performant the closer the DAG looks like a tree, i.e. if each nodes has many children but few parents.
- **Assignments:** `assignments` represent assignments between resources and roles (e.g. share a folder with a group)
  ![assignments](./docs/assignments.png)
- **Unified access control graph:** Once linked, the set of `(resources + roles + assignments)` form a single directed acyclic graph, that is used to compute transitive permissions. In theory we would not even need to differentiate between `resources` and `roles`, but in practice it is useful to do so, since it matches the way most people think of access control, and the tree-like structure of both `resources` and `roles` leads to a hourglass-shaped graph, and harnessing this property is crucial to getting scalably good performance, which would not be atainable with a generalized graph.
  ![dag](./docs/dag.png)
- **Permission bitmap:** Each edge in the graph (`resource` tree edges, `role` tree edges and `assignment`) has a `permission` field, that represents the permissions granted by the edge or assignment. Permissions are represented as bitmaps, with one bit per permitted operation / permission class. 1 means the edge grants permission, and 0 means the edge denies permission. The size of the bitmap is configurable depending on the desired granularity of roles. The semantics of each bit is application-specific, and customizable by the user of this library.
  ![bitmap](./docs/bitmap.png)
- **Compute permissions:** Permissions are computed by considering all paths in the graph from a role node to a resource node. Each individual path can be made of several edges, and the permission associated with a path is the bitwise AND of the permissions of each edge in the path. The permission associated with a role and a resource is the bitwise OR of the permissions of all paths between the role and the resource. This is implemented using cache tables, and triggers to keep the caches up to date.
  ![compute](./docs/compute.png)
- **Row Level Security**: The system can generate Postgres Row Level Security (RLS) policies to enforce permissions of each resource, based on the transitive permissions computed above. This is optional though, the system can also be used with any other access control mechanism, such as a GraphQL middleware, or a custom API.

## Get started

### Setup

```bash
# Install Docker
brew install --cask docker

# Install NodeJS 18+
curl https://get.volta.sh | bash
volta install node@18

# Install packages
yarn install
```

### Develop

```bash
# Start the docker Postgres database
yarn db-start

# Run the tests in interactive mode
yarn test
```

### Run examples

```bash
yarn db-start
yarn dev
```

Serves:

- http://localhost:8080 PgAdmin, user@email.com, password
- http://localhost:5678 GraphiQL

## Features & Roadmap

- [x] Tables for base functionality
  - [x] `resourceNode` represents a business domain object
  - [x] `roleNode` represents a role
  - [x] `resourceEdge` represents a parent-child link between two business domain objects (e.g. a file in a folder)
  - [x] `roleEdge` represents a parent-child link between two roles (e.g. a user in a group)
  - [x] `assignmentEdge` represents a link between a business domain object and a role (e.g. a group is granted access to a folder)
- [x] Configurable permission bitmap size
  - [x] Permissions are represented as a bitmap, with one bit per permission
  - [x] The size of the bitmap is configurable.
  - [x] Recommend being generous when setting bitmap size in order to be future-proof, since changing it in the database is likely to be a costly operation
- [x] Functions to compute transitive permissions (both for `resourceEdge` and `roleEdge`)
  - [x] `edgeCacheParentCompute` computes the transitive permissions edges for a given node, going upwards in the tree (which is typically pretty quick, if each node has few parents)
  - [x] `edgeCacheChildCompute` computes the transitive permissions edges for a given node, going downwards in the tree (which typically is slower, since each node can have many children)
- [x] Views to query transitive permissions (both for `resourceEdge` and `roleEdge`)
  - [x] `resourceEdgeCacheView` is a view that represents all the transitive permissions derived from `resourceEdge`
  - [x] `roleEdgeCacheView` is a view that represents all the transitive permissions derived from `roleEdge`
- [x] Cache the transitive permissions in an actual material table
  - [x] `resourceEdgeCache` stores the transitive persmissions derived from `resourceEdge`
  - [x] `roleEdgeCache` stores the transitive persmissions derived from `roleEdge`
- [x] Add triggers to update caches when edges are CRUDed
  - [x]Triggers to populate `resourceEdgeCache` when `resourceEdge` is CRUDed
  - [x]Triggers to populate `roleEdgeCache` when `roleEdge` is CRUDed
- [x] Add way to backfill cache when needed
  - [x] `resourceEdgeCacheBackfill` function backfills the `resourceEdgeCache`
  - [x] `roleEdgeCacheBackfill` function backfills the `roleEdgeCache`
- [x] Add Row Level Security RLS policies to resources
  - [x] RLS policies are added to tables associated with a `resourceNode`
- [x] Functions to disable and re-enable triggers, for faster batch processing
  - [x] `disableTriggerFunction` disables triggers
  - [x] `enableTriggerFunction` enables triggers and backfills cache using `edgeCacheBackfill`
- [x] Configurable maximum depth when computing cache
  - [x] Defaults to 16
  - [x] Trees deeper than `maxDepth` will not work as expected.
  - [x] If there is a depth of more than `maxDepth` between the node linked to an assignment, and the node linked to a resource, the assignment will not be visible to the resource. Same goes for roles.
- [x] UUID mode (Other existing mode is INTEGER)
  - [x] UUID mode works, but the benchmark shows that it is 2-3x slower than INTEGER mode
- [x] Clean up code, don't treat self-edges differently
- [x] Combined assignment caches
  - [x] Offer a configuration option to make the `assignmentEdgeCache` table include `role` in the graph computation, such that the `assignmentEdgeCache` table is a transitive combination of the `roleEdge` + `assignment` tables. This is a tiny bit slower when writing new `roleEdge` or `assignment` (which is rare), but is much faster to resolve permissions at read time (which is very frequent), since it avoids a join during permission resolution.
  - [x] Similarly, offer a configuration option to make the `assignmentEdgeCache` table include `resource` in the graph computation. (This is only added for symmetry, but is not useful in practice, since in most cases you'll have many more `resources` than `roles`, so this optimization makes less sense than the reciprocal, and they are mutually exclusive)
- [ ] Nodeless mode. We don't actually need the `resourceNode` and `roleNode` tables. They were only useful for a few things that can be avoided:
  - [ ] Enforcing foreign key constraints can be achieved using correct triggers
  - [ ] Generating integer sequences that are shared over multiple business domain tables can be achieved by sharing an integer sequence between multiple tables, or using UUIDs
  - [ ] Creating a more complete datamodel to make tools like Postgraphile happy and ready to serve nodes in a GraphQL Scheme can be achieved differently with views.
- [ ] Single parent optimization for leaves. If the business domain allows for some leaves of the trees (Resources and/or Roles) to only have one single parent, and if the number of that type of leaves is large, then it can be useful to enable single parent optimization for leaves. This can typically be the case in SaaS when modelling data that has access control aggregated at one level (e.g. a `Page` in Notion), but can contain many smaller sub-objects which share the same access control rules (e.g. a `Block` or a `Comment` on a `Page` in Notion). In this case, having the permission system only deal with the `Pages` (small cardinality), and have the permissions for `Block` or `Comment` inherit from the `Page` ones, then single parent optimization for leaves makes sense on the `Block` and `Comment` tables.
  - [ ] Offer a configuration option to enable single parent optimization for `resourceNode`
  - [ ] Similarly, offer a configuration option to enable single parent optimization for `roleNode` (This is only added for symmetry, but is not useful in practice, since in most cases, you'll want users to be able to belong to multiple groups)
- [ ] Seamless CRUD operations, do not require separate creating a node + edge before creating an entity, leverage views and triggers to do it automatically
- [ ] Assignment-driven cache reduction
  - [ ] Do not store all combinatorical possibilities in cache tables, but only store edges starting from assignments.
  - [ ] Simplify `combineAssignmentsWith`. Currently, if set to e.g. `role`, it still maintains the `roleEdgeCache`, and the `roleAssignmentCache` tables. This is more compute-optimized, but less space-optimized. We could stop maintaining `roleEdgeCache` in that case and only focus on `roleAssignmentCache`. This would be a bit more complex, but could save space. If space is an issue, need to consider adding this.
- [ ] Customizable prefix for triggers, to allow ordering p9s triggers with other existing triggers (Postgres runs triggers in alphanumerical order). Before that, triggers are prefixed with `10`, `20`, etc.
- [ ] Functions to batch insert/update/delete edges, to save a lot of compute on redundant things

## Play

```graphql
mutation createRoleNode {
  createRoleNode(input: { roleNode: {} }) {
    roleNode {
      id
    }
  }
}

mutation createResourceNode {
  createResourceNode(input: { resourceNode: {} }) {
    resourceNode {
      id
    }
  }
}

mutation createAssignmentEdge {
  createAssignmentEdge(
    input: {
      assignmentEdge: {
        resourceId: 1
        roleId: 1
        permission: "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"
      }
    }
  ) {
    assignmentEdge {
      role {
        id
        humanUser {
          id
          roleId
          email
        }
      }
      resource {
        id
        folder {
          id
          resourceId
          name
        }
      }
    }
  }
}

mutation createHumanUser {
  createHumanUser(
    input: {
      humanUser: {
        id: "229eceb9-5854-42bd-bc38-e8a71e1e0898"
        email: "vincent.lecrubier@skydio.com"
        roleId: 1
      }
    }
  ) {
    humanUser {
      id
      email
      roleId
    }
  }
}

mutation createFolder {
  createFolder(
    input: {
      folder: {
        id: "e8473cd9-f883-46d3-b3ec-a075a2597a33"
        name: "Vincent's Home"
        resourceId: 1
      }
    }
  ) {
    folder {
      id
      name
      resourceId
    }
  }
}

mutation createSubResourceNode {
  createResourceNode(input: { resourceNode: {} }) {
    resourceNode {
      id
    }
  }
}

mutation createResourceEdge {
  createResourceEdge(
    input: {
      resourceEdge: {
        parentId: 2
        childId: 3
        permission: "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"
      }
    }
  ) {
    resourceEdge {
      parentId
      childId
      parent {
        folder {
          name
        }
      }
      child {
        imageFile {
          name
          url
        }
      }
    }
  }
}

mutation createImageFile {
  createImageFile(
    input: {
      imageFile: {
        name: "foo.jpeg"
        url: "https://images.unsplash.com/photo-1694933042108-1bfc0418cc5f?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=2832&q=80"
        resourceId: 3
      }
    }
  ) {
    imageFile {
      id
      name
      resourceId
    }
  }
}

query getResourcesTree {
  resourceNodesList(filter: { not: { parentResourceEdgesExist: true } }) {
    id
    folder {
      name
    }
    descendants: resourceNodesByResourceEdgeCacheParentIdAndChildIdList {
      id
      imageFile {
        name
      }
    }
    children: resourceNodesByResourceEdgeParentIdAndChildIdList {
      id
      imageFile {
        name
      }
      children: resourceNodesByResourceEdgeParentIdAndChildIdList {
        id
        imageFile {
          name
        }
      }
    }
  }
}

query getResourceEdgeCachesList {
  resourceEdgeCachesList {
    child {
      id
    }
    parent {
      id
    }
  }
}
```
