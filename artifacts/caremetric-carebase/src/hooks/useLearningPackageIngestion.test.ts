import { beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
const h=vi.hoisted(()=>({rpc:vi.fn(),invoke:vi.fn(),invalidate:vi.fn()}));
vi.mock('react',()=>({useRef:(value:unknown)=>({current:value})}));
vi.mock('@tanstack/react-query',()=>({useQuery:vi.fn(),useQueryClient:()=>({invalidateQueries:h.invalidate}),useMutation:(options:unknown)=>options}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc:h.rpc,functions:{invoke:h.invoke}}}));
import { useUploadLearningPackage } from './useLearningPackageIngestion';
import { useAcceptLearningPackage } from './useLearningRuntime';
type Mutation<T>={mutationFn:(input:T)=>Promise<unknown>;onSuccess:()=>void};
const id=(n:number)=>`23000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const file=new File([new Uint8Array([1,2,3])],'original.zip',{type:'application/zip'});
const sha=createHash('sha256').update(new Uint8Array([1,2,3])).digest('hex');
const receipt={operationId:id(4),packageId:id(3),versionId:id(2),status:'pending',sourceRevision:'b'.repeat(64),sourceSha256:sha,runtimeSha256:null,entryPoint:null};
beforeEach(()=>{vi.resetAllMocks();h.invalidate.mockResolvedValue(undefined);});
it('recovers an exact committed original after a lost response without reuploading',async()=>{
 h.rpc.mockResolvedValueOnce({data:{versionId:id(2),sourceRevision:'a'.repeat(64)}}).mockResolvedValueOnce({data:{status:'committed',result:receipt}});
 h.invoke.mockResolvedValue({error:{message:'Lost response'}});
 const hook=useUploadLearningPackage() as unknown as Mutation<{file:File;versionId:string;standard?:'xapi'}>;
 await expect(hook.mutationFn({file,versionId:id(2),standard:'xapi'})).rejects.toThrow('Retry this file');
 await expect(hook.mutationFn({file,versionId:id(2),standard:'xapi'})).resolves.toEqual(receipt);
 expect(h.invoke).toHaveBeenCalledTimes(1);
 const request=JSON.parse(h.invoke.mock.calls[0][1].body.get('request'));
 expect(request).toMatchObject({standard:'xapi',sourceRevision:'a'.repeat(64),sourceSha256:sha,sourceBytes:3});
 expect(h.rpc.mock.calls[1]).toEqual(['get_native_learning_package_operation',{p_request_id:request.requestId}]);
 hook.onSuccess();expect(h.invalidate).toHaveBeenCalledWith({queryKey:['governed_draft_source']});
});
it('reuses the exact request after uncertain staging and stops on current authority revocation',async()=>{
 h.rpc.mockResolvedValueOnce({data:{versionId:id(2),sourceRevision:'a'.repeat(64)}}).mockResolvedValueOnce({data:{status:'pending'}}).mockResolvedValueOnce({error:{message:'Current session revoked'}});
 h.invoke.mockResolvedValue({error:{message:'Lost response'}});
 const hook=useUploadLearningPackage() as unknown as Mutation<{file:File;versionId:string}>;
 await expect(hook.mutationFn({file,versionId:id(2)})).rejects.toThrow();
 await expect(hook.mutationFn({file,versionId:id(2)})).rejects.toThrow();
 expect(h.invoke.mock.calls[1][1].body.get('request')).toEqual(h.invoke.mock.calls[0][1].body.get('request'));
 await expect(hook.mutationFn({file,versionId:id(2)})).rejects.toThrow('revoked');expect(h.invoke).toHaveBeenCalledTimes(2);
});
it('rejects a mismatched course context before sending original bytes',async()=>{
 h.rpc.mockResolvedValue({data:{versionId:id(99),sourceRevision:'a'.repeat(64)}});
 const hook=useUploadLearningPackage() as unknown as Mutation<{file:File;versionId:string}>;
 await expect(hook.mutationFn({file,versionId:id(2)})).rejects.toThrow('Refresh');expect(h.invoke).not.toHaveBeenCalled();
});
it('acceptance retries recover the exact saved receipt and preserve original input identity',async()=>{
 h.rpc.mockResolvedValueOnce({data:{package:{id:id(3)},sourceRevision:'a'.repeat(64)}}).mockResolvedValueOnce({data:{status:'committed',result:{...receipt,status:'accepted'}}});
 h.invoke.mockResolvedValue({error:{message:'Lost acceptance response'}});
 const hook=useAcceptLearningPackage() as unknown as Mutation<{packageId:string;reason:string}>;
 const input={packageId:id(3),reason:'Reviewed original course'};
 await expect(hook.mutationFn(input)).rejects.toThrow('Lost');await expect(hook.mutationFn(input)).resolves.toBeUndefined();
 expect(h.invoke).toHaveBeenCalledTimes(1);expect(h.invoke.mock.calls[0][1].body).toMatchObject({package_id:id(3),source_revision:'a'.repeat(64),reason:input.reason});
 hook.onSuccess();expect(h.invalidate).toHaveBeenCalledWith({queryKey:['governed_draft_source']});
});
