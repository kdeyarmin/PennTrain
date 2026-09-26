import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h=vi.hoisted(()=>({assurance:{canManage:true,canWrite:false,isLoading:false,isError:false,refetch:vi.fn()},verify:vi.fn(),hasProvider:true}));
vi.mock("@/hooks/usePolicyWriteAssurance",()=>({usePolicyWriteAssurance:()=>h.assurance}));
vi.mock("@/lib/identityReverification",()=>({useRequestIdentityVerification:()=>h.hasProvider?h.verify:null}));
import { PolicyWriteAssurance } from "./PolicyWriteAssurance";
type Node=ReactElement<Record<string,unknown>>;
function nodes(value:ReactNode):Node[]{if(Array.isArray(value))return value.flatMap(nodes);if(!value||typeof value!=="object"||!("props" in value))return[];const n=value as Node;return[n,...nodes(n.props.children as ReactNode)];}
describe("policy identity assurance prompt",()=>{
 beforeEach(()=>{vi.clearAllMocks();h.assurance={canManage:true,canWrite:false,isLoading:false,isError:false,refetch:vi.fn()};h.hasProvider=true;});
 it("requests the preserving overlay instead of navigating away from the unsaved form",()=>{const tree=nodes(PolicyWriteAssurance());const verify=tree.find(n=>n.props.children==="Verify identity"&&n.props.onClick)!;(verify.props.onClick as ()=>void)();expect(h.verify).toHaveBeenCalledOnce();expect(tree.some(n=>n.props.href)).toBe(false);});
 it("offers retry on a failed assurance read without treating it as a successful verification",()=>{h.assurance.isError=true;const tree=nodes(PolicyWriteAssurance());const retry=tree.find(n=>n.props.children==="Retry verification")!;(retry.props.onClick as ()=>void)();expect(h.assurance.refetch).toHaveBeenCalledOnce();expect(h.verify).not.toHaveBeenCalled();expect(tree.some(n=>n.props.children==="Verify identity")).toBe(false);});
 it("does not offer privileged re-verification to a reader or an already-current manager",()=>{h.assurance.canManage=false;expect(PolicyWriteAssurance()).toBeNull();h.assurance.canManage=true;h.assurance.canWrite=true;expect(PolicyWriteAssurance()).toBeNull();});
 it("keeps verification disabled while the initial assurance read is unresolved",()=>{h.assurance.isLoading=true;expect(nodes(PolicyWriteAssurance()).some(n=>n.props.children==="Verify identity")).toBe(false);});
});
