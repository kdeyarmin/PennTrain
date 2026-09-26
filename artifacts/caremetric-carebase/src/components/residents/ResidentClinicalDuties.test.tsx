import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ state: [] as unknown[], cursor: 0, rows: [] as unknown[], save: vi.fn(), upload: vi.fn(), invalidate: vi.fn(), toast: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState: (initial: unknown) => {
  const index=h.cursor++; if(!(index in h.state)) h.state[index]=typeof initial==="function" ? initial() : initial;
  return [h.state[index], (value: unknown) => { h.state[index]=typeof value==="function" ? value(h.state[index]) : value; }];
} }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: h.invalidate }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useResidentRegulatoryActions", () => ({ useResidentRegulatoryActions: () => ({ data: h.rows }), useSaveResidentClinicalDuty: () => ({ mutateAsync: h.save }) }));
vi.mock("@/hooks/useResidentDocuments", () => ({ useListResidentDocuments: () => ({ data: [] }), useUploadResidentDocument: () => ({ mutateAsync: h.upload }) }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));
import { ResidentClinicalDuties } from "./ResidentClinicalDuties";
type Node=ReactElement<Record<string,unknown>>;
function nodes(value: ReactNode): Node[] { if(Array.isArray(value)) return value.flatMap(nodes); if(!value || typeof value!=="object" || !("props" in value)) return []; const n=value as Node; return [n,...nodes(n.props.children as ReactNode)]; }
function render(canManage=true) { h.cursor=0; return nodes(ResidentClinicalDuties({ resident:{ id:"resident",organization_id:"org",facility_id:"facility",sdcu:false },facilityType:"ALR",canManage })); }
function click(label:string) { const node=render().find(n=>n.props.children===label)!; return (node.props.onClick as ()=>unknown)(); }
function fill(key:string,value:string) { const node=render().find(n=>n.props.id===`clinical-${key}`)!; (node.props.onChange as (event:unknown)=>void)({target:{value}}); }
describe("resident clinical duty completion",()=>{
  beforeEach(()=>{h.state=[];h.cursor=0;vi.clearAllMocks();h.save.mockResolvedValue([]);h.invalidate.mockResolvedValue(undefined);h.rows=[{id:"duty",action_type:"medication_refusal_notice",status:"pending",anchor_at:"2026-09-01T12:00:00Z",due_at:"2026-09-02T12:00:00Z",reason:"Imported refusal",details:{external_event_id:"source-event"},evidence:null}];});
  it("requires an explicitly recorded completion time and retains the imported refusal link",async()=>{
    click("Record completion / decision");
    expect(render().find(n=>n.props.id==="clinical-completed")?.props.value).toBe("");
    expect(render().find(n=>n.props.children==="Save clinical record")?.props.disabled).toBe(true);
    fill("recipient_name","Dr Recorded Prescriber"); fill("completed","2026-09-01T10:15"); fill("evidence","Prescriber contacted; requested monitoring and next-dose review.");
    click("Save clinical record");
    await vi.waitFor(()=>expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ id:"duty",actionType:"medication_refusal_notice",status:"completed",completedAt:"2026-09-01T14:15:00.000Z",recipientName:"Dr Recorded Prescriber",details:expect.objectContaining({external_event_id:"source-event"}) })));
    expect(h.upload).not.toHaveBeenCalled();
  });
  it("records a prescriber's alternative refusal schedule as evidence, without inventing a completion",async()=>{
    click("Record completion / decision"); fill("prescriber_instruction","Prescriber directed reporting at the next scheduled review; signed order retained.");
    click("Save clinical record");
    await vi.waitFor(()=>expect(h.save).toHaveBeenCalledWith(expect.objectContaining({id:"duty",status:"not_applicable",completedAt:null,exceptionBasis:expect.stringContaining("signed order retained")})));
  });
  it("does not offer write actions to a reader",()=>{
    expect(render(false).some(n=>n.props.children==="Record completion / decision")).toBe(false);
    expect(render(false).some(n=>n.props.children==="Record special-care admission")).toBe(false);
  });
});
