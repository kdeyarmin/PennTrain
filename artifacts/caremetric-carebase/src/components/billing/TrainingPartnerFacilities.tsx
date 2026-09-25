import { useDeferredValue, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { supabase } from "@/lib/supabase";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { QueryError } from "@/components/QueryState";

type Partner = { organization_id: string; organization: string; facility_id: string; facility: string;
  status: string; train_only: boolean; profile_complete: boolean; staff: number; plans: number;
  administrators: { email: string; signed_in: boolean; mfa_ready: boolean }[]; invitation_status: string | null };
export function TrainingPartnerFacilities() {
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const querySearch = useDeferredValue(search);
  const query = useQuery({ queryKey: ["organizations", "training-partners", querySearch, offset],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_training_partner_facilities", { p_search: querySearch, p_offset: offset, p_limit: 25 });
      if (error) throw error;
      const result = data as unknown as { total: number; rows: Partner[] };
      if (!result || !Array.isArray(result.rows)) throw new Error("Partner facility status is unavailable");
      return result;
    } });
  return <section className="rounded-lg border p-4 space-y-3" aria-label="Complimentary partner facilities">
    <h2 className="text-xl font-semibold">Complimentary partner facilities</h2>
    <p className="text-sm text-muted-foreground">Follow administrator activation and facility setup. Training-only partners retain complimentary access independently of a paid trial.</p>
    <label className="block max-w-md text-sm">Find partner facility<Input value={search} maxLength={200} onChange={e => { setSearch(e.target.value); setOffset(0); }} /></label>
    {query.isError ? <QueryError what="partner facilities" error={query.error} onRetry={() => void query.refetch()} /> : query.isLoading ? <p>Loading partner facilities…</p> : <>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["Facility", "Access", "Administrator", "Setup", "Actions"].map(value => <th className="p-2 border-b" key={value}>{value}</th>)}</tr></thead><tbody>{query.data?.rows.map(row => <tr key={row.facility_id}>
        <td className="p-2 border-b">{row.facility}<p className="text-xs">{row.organization}</p></td>
        <td className="p-2 border-b">{row.train_only ? "Complimentary partner — Training only" : "Complimentary Training with additional module access"}<p className="text-xs">{row.status}</p></td>
        <td className="p-2 border-b">{row.administrators.length ? row.administrators.map(admin => <p key={admin.email}>{admin.email}<span className="block text-xs">{admin.signed_in ? "Signed in" : "Awaiting first sign-in"} · {admin.mfa_ready ? "Verification method enrolled" : "Account security setup pending"}</span></p>) : "No active administrator"}<p className="text-xs">Latest invitation: {row.invitation_status || "Not recorded"}</p></td>
        <td className="p-2 border-b">{row.profile_complete ? "Facility details confirmed" : "Facility details incomplete"}<p className="text-xs">{row.staff} active staff · {row.plans} learning plans</p></td>
        <td className="p-2 border-b"><div className="flex flex-col gap-2"><Link className="underline" href={`/admin/organizations/${row.organization_id}`}>Manage facility access</Link><Link className="underline" href={`/admin/users?action=invite&organizationId=${row.organization_id}&role=org_admin&source=train`}>Administrator invitation</Link><Link className="underline" href={`/admin/training-reports?organizationId=${row.organization_id}`}>Training reports</Link></div></td>
      </tr>)}</tbody></table></div>
      {!query.data?.total && <p>No current complimentary Training partners match.</p>}
      <div className="flex gap-2 items-center"><Button variant="outline" disabled={!offset || query.isFetching} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous partners</Button><span>{query.data?.total || 0} partner facilities</span><Button variant="outline" disabled={offset + 25 >= (query.data?.total || 0) || query.isFetching} onClick={() => setOffset(offset + 25)}>Next partners</Button></div>
    </>}
  </section>;
}
