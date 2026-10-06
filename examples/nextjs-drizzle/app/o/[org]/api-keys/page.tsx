import { headers } from "next/headers";
import { ApiKeys } from "@/components/api-keys";
import { PageBody, PageHeader } from "@/components/page-header";
import { listApiKeys } from "@/src/service";
import { requireActor } from "@/src/session";

export default async function ApiKeysPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const actor = await requireActor(slug);
  const keys = await listApiKeys(actor);
  const host = (await headers()).get("host") ?? "localhost:3000";

  return (
    <>
      <PageHeader path={[{ label: actor.org.name, href: `/o/${slug}` }, { label: "API keys" }]} />
      <PageBody className="flex max-w-3xl flex-col gap-4 p-6">
        <p className="text-muted-foreground text-sm">
          A key acts as you in {actor.org.name}, with exactly your permissions, and follows them when they change. It is a role leaf in p9s: it has
          its own role id, so the API knows which key made a request, but it is not a node of the graph.
        </p>
        {actor.impersonator && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            These are {actor.name}&apos;s keys. Only they can create or revoke them, not an admin acting as them.
          </p>
        )}
        <ApiKeys orgSlug={slug} keys={keys} origin={`${host.startsWith("localhost") ? "http" : "https"}://${host}`} />
      </PageBody>
    </>
  );
}
