import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ state: [] as unknown[], cursor: 0, rows: [] as unknown[], docs: [] as unknown[], items: [] as unknown[], save: vi.fn(), upload: vi.fn(), invalidate: vi.fn(), toast: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState: (initial: unknown) => {
  const index=h.cursor++; if(!(index in h.state)) h.state[index]=typeof initial==="function" ? initial() : initial;
  return [h.state[index], (value: unknown) => { h.state[index]=typeof value==="function" ? value(h.state[index]) : value; }];
} }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: h.invalidate }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useResidentRegulatoryActions", () => ({ useResidentRegulatoryActions: () => ({ data: h.rows }), useSaveResidentClinicalDuty: () => ({ mutateAsync: h.save }) }));
vi.mock("@/hooks/useResidentDocuments", () => ({ useListResidentDocuments: () => ({ data: h.docs }), useUploadResidentDocument: () => ({ mutateAsync: h.upload }) }));
vi.mock("@/hooks/useResidentComplianceItems", () => ({ useListResidentComplianceItems: () => ({ data: h.items }) }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));
import { ResidentClinicalDuties } from "./ResidentClinicalDuties";
import { equivalentClinicalItemAllowed } from "@/lib/residentClinicalDuties";
type Node=ReactElement<Record<string,unknown>>;
function nodes(value: ReactNode): Node[] { if(Array.isArray(value)) return value.flatMap(nodes); if(!value || typeof value!=="object" || !("props" in value)) return []; const n=value as Node; return [n,...nodes(n.props.children as ReactNode)]; }
function render(canManage=true) { h.cursor=0; return nodes(ResidentClinicalDuties({ resident:{ id:"resident",organization_id:"org",facility_id:"facility",sdcu:false },facilityType:"ALR",canManage })); }
function click(label:string) { const node=render().find(n=>n.props.children===label)!; return (node.props.onClick as ()=>unknown)(); }
function fill(key:string,value:string) { const node=render().find(n=>n.props.id===`clinical-${key}`)!; (node.props.onChange as (event:unknown)=>void)({target:{value}}); }
describe("resident clinical duty completion",()=>{
  beforeEach(()=>{h.state=[];h.cursor=0;h.docs=[];h.items=[];vi.clearAllMocks();h.save.mockResolvedValue([]);h.invalidate.mockResolvedValue(undefined);h.rows=[{id:"duty",action_type:"medication_refusal_notice",status:"pending",anchor_at:"2026-09-01T12:00:00Z",due_at:"2026-09-02T12:00:00Z",reason:"Imported refusal",details:{external_event_id:"source-event"},evidence:null}];});
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
  it("offers matching combined documents without requiring a separate compliance completion",()=>{
    const scope={organization_id:"org",facility_id:"facility",resident_id:"resident"};
    h.rows=[{id:"duty",action_type:"scu_plan_review",status:"pending",anchor_at:"2026-09-01T12:00:00Z",due_at:"2026-12-01T12:00:00Z",reason:"Plan review",details:{unit_type:"dementia"}}];
    h.items=[{...scope,id:"initial",item_type:"initial_assessment_15day"},{...scope,id:"quarter",item_type:"support_plan_quarterly_review",status:"missing",completed_date:null}];
    h.docs=[
      {...scope,id:"initial-doc",compliance_item_id:"initial",document_label:"Initial assessment",equivalent_form_review:{}},
      {...scope,id:"quarter-doc",compliance_item_id:"quarter",document_label:"Reviewed combined ASP",equivalent_form_review:{}},
      {...scope,id:"official",document_label:"DHS plan",is_state_form:true},
      {...scope,id:"generic",document_label:"Ordinary upload"},
      {...scope,id:"foreign",facility_id:"other-facility",document_label:"Wrong facility",is_state_form:true},
    ];
    click("Record completion / decision");
    const options=render().filter(n=>typeof n.props.value==="string").map(n=>n.props.value);
    expect(options).toContain("quarter-doc");expect(options).toContain("official");
    expect(options).not.toContain("initial-doc");expect(options).not.toContain("generic");expect(options).not.toContain("foreign");
  });
  it("keeps admission screening distinct while allowing chapter-appropriate combined reviews",()=>{
    for(const chapter of ["PCH","ALR"]) {
      for(const action of ["scu_admission","scu_support_plan","scu_plan_review","scu_continuing_need"]) expect(equivalentClinicalItemAllowed(chapter,action,"initial_assessment_15day")).toBe(false);
      expect(equivalentClinicalItemAllowed(chapter,"scu_admission","annual_reassessment")).toBe(false);
      expect(equivalentClinicalItemAllowed(chapter,"scu_plan_review","annual_reassessment")).toBe(true);
      expect(equivalentClinicalItemAllowed(chapter,"scu_continuing_need","significant_change_reassessment")).toBe(true);
      expect(equivalentClinicalItemAllowed(chapter,"scu_continuing_need","support_plan_30day")).toBe(false);
      expect(equivalentClinicalItemAllowed(chapter,"scu_support_plan","initial_assessment_15day",true)).toBe(true);
      expect(equivalentClinicalItemAllowed(chapter,"scu_plan_review","initial_assessment_15day",true)).toBe(false);
    }
    expect(equivalentClinicalItemAllowed("ALR","scu_continuing_need","support_plan_quarterly_review")).toBe(true);
    expect(equivalentClinicalItemAllowed("PCH","scu_plan_review","support_plan_quarterly_review")).toBe(false);
  });
  it("requires a fresh SCU plan confirmation for a combined initial assessment and resets it when the evidence changes",async()=>{
    const scope={organization_id:"org",facility_id:"facility",resident_id:"resident"};
    h.rows=[{id:"duty",action_type:"scu_support_plan",status:"pending",anchor_at:"2026-09-01T12:00:00Z",due_at:"2026-09-04T12:00:00Z",reason:"Initial unit plan",details:{unit_type:"dementia",initial_support_plan_confirmed:"true"}}];
    h.items=[{...scope,id:"initial",item_type:"initial_assessment_15day"}];
    h.docs=["first","second"].map(id=>({...scope,id,compliance_item_id:"initial",document_label:id,equivalent_form_review:{}}));
    const selectDocument=(value:string)=>{
      const select=render().find(n=>typeof n.props.onValueChange==="function" && nodes(n.props.children as ReactNode).some(child=>child.props.id==="clinical-document_id"))!;
      (select.props.onValueChange as (value:string)=>void)(value);
    };
    const confirm=(checked:boolean)=>(render().find(n=>n.props.id==="clinical-initial-support-plan-confirmed")!.props.onChange as (event:unknown)=>void)({target:{checked}});
    const saveDisabled=()=>render().find(n=>n.props.children==="Save clinical record")!.props.disabled;
    click("Record completion / decision");selectDocument("first");
    fill("completed","2026-09-01T14:15");fill("evidence","SCU support plan addresses current needs and resident participation.");
    expect(saveDisabled()).toBe(true);confirm(false);expect(saveDisabled()).toBe(true);
    confirm(true);expect(saveDisabled()).toBe(false);
    selectDocument("second");expect(saveDisabled()).toBe(true);
    confirm(true);expect(saveDisabled()).toBe(false);
    h.rows=[{...(h.rows[0] as Record<string,unknown>),id:"different-duty"}];
    click("Record completion / decision");selectDocument("first");
    expect(render().find(n=>n.props.id==="clinical-initial-support-plan-confirmed")!.props.checked).toBe(false);
    fill("completed","2026-09-01T14:15");fill("evidence","This combined form includes the actual SCU plan for admission.");confirm(true);
    click("Save clinical record");
    await vi.waitFor(()=>expect(h.save).toHaveBeenCalledWith(expect.objectContaining({id:"different-duty",details:expect.objectContaining({document_id:"first",initial_support_plan_confirmed:"true"})})));
  });
});
