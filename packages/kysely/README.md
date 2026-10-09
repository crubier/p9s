# @p9s/kysely

Runs [Kysely](https://kysely.dev) transactions as a user of [p9s](https://p9s.vercel.app), so that every query of the
transaction goes through the policies:

```ts
import { createIdentity } from "@p9s/postgres";
import { withUser } from "@p9s/kysely";
import config from "./p9s.config.json";

const users = createIdentity(config);

const documents = await withUser(db, users, userId, trx =>
  trx.selectFrom("documents").select(["id", "title"]).orderBy("id").execute(), { readOnly: true });
```

See the [Kysely example](https://github.com/crubier/p9s/tree/main/examples/kysely), which adopts p9s in an existing app.
