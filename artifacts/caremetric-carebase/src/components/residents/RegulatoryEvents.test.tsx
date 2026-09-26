import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h=vi.hoisted(()=>({ state:[] as unknown[],cursor:0,rpc:vi.fn(),invalidate:vi.fn(),toast:vi.fn() }));
vi.mock("react",async original=>({...await original<typeof import("react")>(),useId:()=>"event-form",useState:(initial:unknown)=>{const i=h.cursor++;if(!(i in h.state))h.state[i]=typeof initial==="function"?initial():initial;return[h.state[i],(value:unknown)=>{h.state[i]=typeof value==="function"?value(h.state[i]):value;}];}}));
vi.mock("@tanstack/react-query",()=>({useQuery:()=>({data:[]}),useQueryClient:()=>({invalidateQueries:h.invalidate}),useMutation:(options:{mutationFn:()=>Promise<unknown>;onSuccess:()=>void;onError:(error:unknown)=>void})=>({isPending:false,mutate:()=>void options.mutationFn().then(options.onSuccess,options.onError)})}));
vi.mock("@/lib/supabase",()=>({supabase:{rpc:h.rpc}}));
vi.mock("@/hooks/use-toast",()=>({useToast:()=>({toast:h.toast})}));
import { RegulatoryEvents } from "./RegulatoryEvents";
type Node=ReactElement<Record<string,unknown>>;
function nodes(value:ReactNode):Node[]{if(Array.isArray(value))return value.flatMap(nodes);if(!value||typeof value!=="object"||!("props" in value))return[];const n=value as Node;return[n,...nodes(n.props.children as ReactNode)];}
let residentId:string|undefined;
function render(canManage=true){h.cursor=0;return nodes(RegulatoryEvents({facilityId:"facility-scope",residentId,canManage}));}
function click(label:string){const n=render().find(node=>node.props.children===label&&node.props.onClick)!;(n.props.onClick as ()=>void)();}
function fill(key:string,value:string){const n=render().find(node=>node.props.id===`event-form-${key}`&&node.props.onChange)!;(n.props.onChange as (event:unknown)=>void)({target:{value}});}
function choose(current:string,value:string){const n=render().find(node=>node.props.value===current&&node.props.onValueChange)!;(n.props.onValueChange as (value:string)=>void)(value);}
describe("regulatory event form",()=>{
 beforeEach(()=>{h.state=[];h.cursor=0;residentId="resident-scope";vi.clearAllMocks();h.rpc.mockResolvedValue({error:null});h.invalidate.mockResolvedValue(undefined);});
 it("requires an actual entered time and sends resident scope plus the departure decision",async()=>{
  click("Record triggering event");expect(render().find(n=>n.props.id==="event-form-at")?.props.value).toBe("");expect(render().find(n=>n.props.children==="Record event")?.props.disabled).toBe(true);
  fill("at","2026-11-02T10:15");fill("reason","  Planned resident move  ");fill("evidence","  Decision reference  ");fill("destination","  Receiving residence  ");choose("facility","resident");click("Record event");
  await vi.waitFor(()=>expect(h.rpc).toHaveBeenCalledWith("record_resident_regulatory_event",{p_facility_id:"facility-scope",p_resident_id:"resident-scope",p_event_type:"departure_plan",p_event_at:"2026-11-02T15:15:00.000Z",p_reason:"Planned resident move",p_evidence:"Decision reference",p_details:{initiator:"resident",destination:"Receiving residence"}}));
  await vi.waitFor(()=>expect(h.invalidate).toHaveBeenCalledWith({queryKey:["resident_regulatory_actions"]}));
 });
 it("requires and sends qualified emergency certification rather than assuming the exception",async()=>{
  click("Record triggering event");fill("at","2026-09-25T08:30");fill("reason","Emergency transfer");fill("evidence","Transfer evidence");fill("destination","Hospital");choose("facility","emergency");
  expect(render().find(n=>n.props.children==="Record event")?.props.disabled).toBe(true);choose("physician","department");fill("certification","DHS written emergency determination");click("Record event");
  await vi.waitFor(()=>expect(h.rpc).toHaveBeenCalledWith("record_resident_regulatory_event",expect.objectContaining({p_details:{initiator:"emergency",destination:"Hospital",certifier:"department",certification_evidence:"DHS written emergency determination"}})));
 });
 it("keeps facility closure events free of an invented resident recipient",async()=>{
  residentId=undefined;click("Record triggering event");fill("at","2026-12-01T09:00");fill("reason","Planned licensed closure");fill("evidence","Approved relocation plan");click("Record event");
  await vi.waitFor(()=>expect(h.rpc).toHaveBeenCalledWith("record_resident_regulatory_event",expect.objectContaining({p_facility_id:"facility-scope",p_resident_id:undefined,p_event_type:"facility_closure_plan",p_event_at:"2026-12-01T14:00:00.000Z",p_details:{}})));
  expect(render().some(n=>n.props.value==="departure_plan")).toBe(false);
 });
 it("retains entered evidence when the server rejects the event",async()=>{
  h.rpc.mockResolvedValue({error:new Error("Resident outside scope")});click("Record triggering event");fill("at","2026-09-25T08:30");fill("reason","Recorded move");fill("evidence","Retained evidence");fill("destination","Receiving home");click("Record event");
  await vi.waitFor(()=>expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({variant:"destructive"})));expect(render().find(n=>n.props.id==="event-form-evidence")?.props.value).toBe("Retained evidence");expect(h.invalidate).not.toHaveBeenCalled();
 });
 it("does not expose event creation to a reader",()=>{expect(render(false).some(n=>n.props.children==="Record triggering event")).toBe(false);});
});
