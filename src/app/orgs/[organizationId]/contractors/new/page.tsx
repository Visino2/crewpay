import type { Metadata } from "next";

import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ContractorForm } from "@/features/contractors/components/contractor-form";
import { requireOrgPermission } from "@/features/organizations/context";

export const metadata: Metadata = { title: "Add contractor" };

export default async function NewContractorPage({ params }: PageProps<"/orgs/[organizationId]/contractors/new">) {
  const { organizationId } = await params;
  await requireOrgPermission(organizationId, "prepare");

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col">
      <PageHeader
        back={{ href: `/orgs/${organizationId}/contractors`, label: "Contractors" }}
        title="Add a contractor"
        description="Start with who they are. You'll add payout details on the next screen."
      />
      <Card>
        <CardContent>
          <ContractorForm mode="create" organizationId={organizationId} />
        </CardContent>
      </Card>
    </div>
  );
}
