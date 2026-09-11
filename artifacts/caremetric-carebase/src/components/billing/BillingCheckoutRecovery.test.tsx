import type {ReactElement, ReactNode} from "react";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
const h=vi.hoisted(()=>({state:[] as unknown[],cursor:0,cleanup:()=>{},recover:vi.fn(),assign:vi.fn()}));
// Execute actual event handlers and next renders using the repository's existing component harness.
vi.mock("react",async original=>({...await original<typeof import("react")>(),
 useState:(initial:unknown)=>{const index=h.cursor++;if(!(index in h.state))h.state[index]=initial;
  return [h.state[index],(value:unknown)=>{h.state[index]=value;}];},
 useRef:(initial:unknown)=>{const index=h.cursor++;if(!(index in h.state))h.state[index]={current:initial};return h.state[index];},
 useEffect:(effect:()=>()=>void)=>{const index=h.cursor++;if(!(index in h.state)){h.state[index]=true;h.cleanup=effect();}},
}));
vi.mock("@/hooks/useEnterpriseFoundation",()=>({recoverBillingCheckout:h.recover}));
import {BillingCheckoutRecovery} from "./BillingCheckoutRecovery";
type Node=ReactElement<Record<string,unknown>>;
function nodes(node:ReactNode):Node[]{if(Array.isArray(node))return node.flatMap(nodes);if(!node||typeof node!=="object"||!("props"in node))return [];const n=node as Node;return[n,...nodes(n.props.children as ReactNode)];}
function text(node:ReactNode):string{if(typeof node==="string"||typeof node==="number")return String(node);if(Array.isArray(node))return node.map(text).join("");return node&&typeof node==="object"&&"props"in node?text((node as Node).props.children as ReactNode):"";}
function render(){h.cursor=0;return BillingCheckoutRecovery({organizationId:"org"});}
function button(label:string){return nodes(render()).find(n=>typeof n.props.onClick==="function"&&text(n.props.children as ReactNode)===label);}
function click(label:string){const target=button(label);expect(target).toBeDefined();(target!.props.onClick as ()=>void)();}
async function settled(){await vi.waitFor(()=>expect(button("Check existing Checkout")).toBeDefined());}
const url="https://checkout.stripe.com/c/pay/cs_test_fixture#safe%2Ffragment";
const open={kind:"checkout_recovery",targetId:"org",canStartNewCheckout:false,
 preview:{commandId:"command",action:"billing.checkout.recover",summary:{organizationName:"Organization",packageId:"original",billingInterval:"year",intervalCount:1,quantity:7,trialDays:0}},
 result:{commandId:"command",action:"billing.checkout.recover",targetId:"org",outcome:"open",availability:"available",checkedAt:new Date().toISOString(),canStartNewCheckout:false,
 session:{id:"cs_test_fixture",url,expiresAt:"2099-01-01T00:00:00Z",livemode:false}}};
beforeEach(()=>{vi.resetAllMocks();h.state=[];h.cursor=0;h.cleanup=()=>{};vi.stubGlobal("window",{location:{assign:h.assign}});});
afterEach(()=>{h.cleanup();vi.unstubAllGlobals();});
it("inspects original terms without navigation and opens only after a fresh provider observation",async()=>{
 h.recover.mockResolvedValueOnce(open).mockResolvedValueOnce({...open,result:{...open.result,outcome:"pending",session:null,availability:"unavailable"}});
 click("Check existing Checkout");await settled();expect(text(render())).toContain("Original terms: every 1 year");
 expect(h.assign).not.toHaveBeenCalled();expect(JSON.stringify(h.state)).not.toContain(url);
 click("Check and open existing Checkout");await settled();expect(text(render())).toContain("Provider observation: pending");
 expect(h.recover).toHaveBeenCalledTimes(2);expect(h.recover.mock.calls[1][1]).toEqual(h.recover.mock.calls[0][1]);
 expect(h.assign).not.toHaveBeenCalled();expect(button("Check and open existing Checkout")).toBeUndefined();
});
it("suppresses duplicate clicks and stale navigation after unmount",async()=>{
 let resolve!:(value:unknown)=>void;h.recover.mockResolvedValueOnce(open).mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 click("Check existing Checkout");await settled();const target=button("Check and open existing Checkout")!;
 (target.props.onClick as ()=>void)();(target.props.onClick as ()=>void)();expect(h.recover).toHaveBeenCalledTimes(2);
 h.cleanup();resolve(open);await Promise.resolve();expect(h.assign).not.toHaveBeenCalled();
});
it("does not equate no reservation with absence of a blocking subscription",async()=>{
 h.recover.mockResolvedValue({kind:"checkout_recovery",targetId:"org",preview:null,result:null,canStartNewCheckout:false});
 click("Check existing Checkout");await settled();expect(text(render())).toContain("No unresolved Checkout reservation was found.");
 expect(text(render())).toContain("A new Checkout is not currently available");expect(h.assign).not.toHaveBeenCalled();
});
it("opens only the fresh fixed-host session and rejects a substituted host",async()=>{
 h.recover.mockResolvedValue(open);click("Check existing Checkout");await settled();click("Check and open existing Checkout");await settled();expect(h.assign).toHaveBeenCalledWith(url);
 h.assign.mockClear();h.recover.mockResolvedValue({...open,result:{...open.result,session:{...open.result.session,url:"https://other.test/c/pay/cs_test_fixture"}}});
 click("Check and open existing Checkout");await settled();expect(h.assign).not.toHaveBeenCalled();
});
