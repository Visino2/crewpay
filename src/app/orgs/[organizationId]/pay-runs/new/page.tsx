import type { Metadata } from "next";

import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireOrgPermission } from "@/features/organizations/context";
import { CreatePayRunForm } from "@/features/pay-runs/components/create-pay-run-form";

export const metadata: Metadata = { title: "New pay run" };

export default async function NewPayRunPage({ params }: PageProps<"/orgs/[organizationId]/pay-runs/new">) {
  const { organizationId } = await params;
  await requireOrgPermission(organizationId, "prepare");
  const defaultMonth = new Date().toISOString().slice(0, 7);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col">
      <PageHeader
        back={{ href: `/orgs/${organizationId}/pay-runs`, label: "Pay runs" }}
        title="New pay run"
        description="Create a draft for a pay period. You'll add contractors and amounts next."
      />
      <Card>
        <CardContent>
          <CreatePayRunForm organizationId={organizationId} defaultMonth={defaultMonth} />
        </CardContent>
      </Card>
    </div>
  );
}
