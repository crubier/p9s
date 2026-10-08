import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useState } from "react";
import { toast } from "sonner";
import type { TypedDocumentString } from "@/gql/graphql";
import { request, type RequestOptions } from "./graphql";
import type { Flags } from "./permissions";

// The organization of the page, from the URL, with what the layout read about it
export interface Organization {
  rowId: string;
  name: string;
  slug: string;
  permission: Flags | null;
  // The member requests act as: the signed-in user, or the member an admin impersonates
  member: { rowId: string; name: string };
  impersonation: { adminName: string; readOnly: boolean } | null;
}

const OrganizationContext = createContext<Organization | undefined>(undefined);

export const OrganizationProvider = OrganizationContext.Provider;

export const useOrganization = () => {
  const organization = useContext(OrganizationContext);
  if (!organization) throw new Error("useOrganization is used outside of an organization");
  return organization;
};

const useSlug = () => useContext(OrganizationContext)?.slug;

// An operation of the page, cached by React Query, in the organization of the page if any
export function useApi<Result, Variables>(
  document: TypedDocumentString<Result, Variables>,
  variables: Variables,
  options: Omit<RequestOptions, "org"> & { org?: string; enabled?: boolean } = {},
) {
  const contextSlug = useSlug();
  const org = options.org ?? contextSlug;
  return useQuery({
    queryKey: [org, document.toString(), variables],
    queryFn: () => request(document, variables, { org }),
    enabled: options.enabled,
  });
}

// Runs mutations in the organization of the page, shows their error or a success message, then reloads every query,
// as what a change affects is decided by the database
export function useAction() {
  const queryClient = useQueryClient();
  const org = useSlug();
  const [pending, setPending] = useState(false);
  const mutate = <Result, Variables>(document: TypedDocumentString<Result, Variables>, variables: Variables) =>
    request(document, variables, { org });
  const run = async <T,>(action: (send: typeof mutate) => Promise<T>, success?: string): Promise<{ value: T; error?: undefined } | { error: string }> => {
    setPending(true);
    try {
      const value = await action(mutate);
      await queryClient.invalidateQueries();
      if (success) toast.success(success);
      return { value };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
      return { error: message };
    } finally {
      setPending(false);
    }
  };
  return { pending, run };
}
