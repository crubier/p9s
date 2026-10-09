# @p9s/prisma

Runs [Prisma](https://www.prisma.io) queries as a user of [p9s](https://p9s.vercel.app), so that the row level security
policies of the permission graph decide what each user reads and writes.

```ts
import { createIdentity } from "@p9s/postgres";
import { userClient, withUser } from "@p9s/prisma";
import { p9sConfig } from "./p9s";

const users = createIdentity(p9sConfig);

// Every query runs in a transaction of its own, as the user
const posts = await userClient(prisma, users, session.userId).post.findMany();

// Several queries in one transaction, as the user
await withUser(prisma, users, session.userId, async tx => {
  const post = await tx.post.create({ data: { title: "Hello", folderId } });
  await tx.comment.create({ data: { body: "First", postId: post.id } });
});

// Read only transactions refuse writes
await userClient(prisma, users, session.userId, { readOnly: true }).post.count();
```

The settings of the user, its database role and its id, are local to the transaction: a pooled connection keeps
nothing of them. The config needs `engine.authentication.setting`, see
[acting as a user](https://p9s.vercel.app/docs/configuration/identity).
