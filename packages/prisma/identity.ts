import type { Identity, RunOptions, UserId } from "@p9s/postgres";

// What a Prisma client has, as a shape rather than its generated class
export interface RawClient {
  $executeRawUnsafe(query: string, ...values: any[]): PromiseLike<number>;
}

export interface BatchClient extends RawClient {
  $extends(extension: any): unknown;
  $transaction(operations: PromiseLike<unknown>[]): Promise<unknown[]>;
}

export interface InteractiveClient<Tx> {
  $transaction<T>(fn: (tx: Tx) => Promise<T>, options?: any): Promise<T>;
}

// The statements that start a transaction of the user: read only first, as it has to come before any query
const statements = (client: RawClient, identity: Identity, userId: UserId, options: RunOptions) => {
  const { text, values } = identity.statement(userId, options);
  return [
    ...(options.readOnly ? [client.$executeRawUnsafe("set transaction read only")] : []),
    client.$executeRawUnsafe(text, ...values),
  ];
};

// A client whose every query runs as the user, in a transaction of its own that starts with the settings of the user,
// so that the policies apply and a pooled connection keeps nothing of them. Query extensions keep the type of the
// client. For several queries in one transaction, use withUser.
export const userClient = <Client extends BatchClient>(prisma: Client, identity: Identity, userId: UserId, options: RunOptions = {}): Client =>
  prisma.$extends({
    query: {
      async $allOperations({ args, query }: { args: unknown; query: (args: unknown) => PromiseLike<unknown> }) {
        const results = await prisma.$transaction([...statements(prisma, identity, userId, options), query(args)]);
        return results[results.length - 1];
      },
    },
  }) as Client;

// Runs fn in an interactive transaction as the user: every query of tx goes through the policies
export const withUser = <Tx extends RawClient, T>(
  prisma: InteractiveClient<Tx>,
  identity: Identity,
  userId: UserId,
  fn: (tx: Tx) => Promise<T>,
  options: RunOptions = {},
): Promise<T> =>
  prisma.$transaction(async (tx) => {
    for (const statement of statements(tx, identity, userId, options)) await statement;
    return fn(tx);
  });
