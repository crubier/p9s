import type { TypedDocumentString } from "@/gql/graphql";

// The headers the server reads, see src/identity.ts
const ORG_HEADER = "x-p9s-org";
const CHECK_ROWS_HEADER = "x-p9s-check-rows";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly codes: (string | undefined)[],
  ) {
    super(message);
  }
}

export interface RequestOptions {
  // The slug of the organization the request acts in
  org?: string;
  // For pages of rows that RLS checks one by one: the server gives up quickly if that is slow, and this asks again
  // without
  checkRows?: boolean;
}

// The app only talks to the API: every request is an operation of web/, the same one GraphiQL opens
export async function request<Result, Variables>(
  document: TypedDocumentString<Result, Variables>,
  variables: Variables,
  { org, checkRows = false }: RequestOptions = {},
): Promise<Result> {
  const response = await fetch("/graphql", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/graphql-response+json, application/json",
      ...(org ? { [ORG_HEADER]: org } : {}),
      ...(checkRows ? { [CHECK_ROWS_HEADER]: "on" } : {}),
    },
    body: JSON.stringify({ query: document.toString(), variables }),
  });
  const body = (await response.json().catch(() => ({ errors: [{ message: `The server answered ${response.status}` }] }))) as {
    data?: Result;
    errors?: { message: string; extensions?: { code?: string } }[];
  };
  if (body.errors?.length) {
    if (checkRows && body.errors.some((error) => error.extensions?.code === "57014")) return request(document, variables, { org });
    throw new ApiError(body.errors.map((error) => error.message).join("\n"), body.errors.map((error) => error.extensions?.code));
  }
  return body.data!;
}

// GraphiQL with the operation of a page, its variables, and the organization header
export const graphiqlHref = (document: { toString(): string }, variables?: object, org?: string) => {
  // Codegen keeps the indentation of the template literals before each definition
  const query = document.toString().trim().replace(/^ +(?=query|mutation|fragment)/gm, "").replace(/\n(?=fragment)/g, "\n\n");
  const params = new URLSearchParams({ query });
  if (variables && Object.keys(variables).length) params.set("variables", JSON.stringify(variables, null, 2));
  if (org) params.set("org", org);
  return `/graphiql?${params}`;
};
