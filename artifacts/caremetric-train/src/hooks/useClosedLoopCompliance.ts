import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { EnterpriseRecord } from "@/hooks/useEnterpriseFoundation";
interface RpcResult{data:unknown;error:{message:string}|null} interface RpcClient{rpc:(name:string,args?:Record<string,unknown>)=>PromiseLike<RpcResult>}
const client=supabase as unknown as RpcClient; const asRecord=(v:unknown):EnterpriseRecord=>v&&typeof v==="object"&&!Array.isArray(v)?v as EnterpriseRecord:{};
export function useClosedLoopCompliance(){return useQuery({queryKey:["closed-loop-compliance"],queryFn:async()=>{const{data,error}=await client.rpc("get_closed_loop_compliance_control_plane");if(error)throw new Error(error.message);const r=asRecord(data);return{work:asRecord(r.work),incidents:asRecord(r.incidents),moveIns:asRecord(r.moveIns),reports:asRecord(r.reports),evidenceRoom:asRecord(r.evidenceRoom),generatedAt:typeof r.generatedAt==="string"?r.generatedAt:null}},staleTime:30_000,refetchInterval:60_000})}
export function useClosedLoopCommand(){const qc=useQueryClient();return useMutation({mutationFn:async({rpc,args}:{rpc:string;args:Record<string,unknown>})=>{const{data,error}=await client.rpc(rpc,args);if(error)throw new Error(error.message);return data},onSuccess:async()=>{await qc.invalidateQueries({queryKey:["closed-loop-compliance"]})}})}
