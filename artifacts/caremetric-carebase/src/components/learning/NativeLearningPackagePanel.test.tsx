import type { ReactElement, ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({state:[] as unknown[],cursor:0,context:{data:null as unknown,isError:false,refetch:vi.fn()},upload:vi.fn(),rpc:vi.fn(),invalidate:vi.fn(),mutate:vi.fn(),query:vi.fn(),options:null as unknown}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),useRef:(value:unknown)=>({current:value}),useState:(value:unknown)=>{
 const i=h.cursor++;if(!(i in h.state))h.state[i]=value;return[h.state[i],(next:unknown)=>{h.state[i]=next;}];}}));
vi.mock('@tanstack/react-query',()=>({useQuery:(options:unknown)=>{h.query(options);return h.context;},useQueryClient:()=>({invalidateQueries:h.invalidate}),useMutation:(options:unknown)=>{h.options=options;return {mutate:h.mutate,isPending:false};}}));
vi.mock('@/hooks/useLearningPackageIngestion',()=>({useUploadLearningPackage:()=>({mutate:h.upload,isPending:false})}));
vi.mock('@/hooks/useLearningRuntime',()=>({useAdminLearningPackages:()=>({data:[],refetch:vi.fn()}),useAcceptLearningPackage:vi.fn()}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc:h.rpc}}));
import { NativeLearningPackagePanel } from './NativeLearningPackagePanel';
type Node=ReactElement<Record<string,unknown>>;
function nodes(node:ReactNode):Node[]{if(Array.isArray(node))return node.flatMap(nodes);if(!node||typeof node!=='object'||!('props'in node))return [];const n=node as Node;return[n,...nodes(n.props.children as ReactNode)];}
function text(node:ReactNode):string{if(typeof node==='string'||typeof node==='number')return String(node);if(Array.isArray(node))return node.map(text).join('');return node&&typeof node==='object'&&'props'in node?text((node as Node).props.children as ReactNode):'';}
function render(disabled=false){h.cursor=0;return NativeLearningPackagePanel({versionId:'version',userId:'actor',disabled});}
const intent={operationId:'operation',requestId:'request',operation:'accept',packageId:'package',sourceSha256:'a'.repeat(64),state:'staged',canFinishThisSession:true};
beforeEach(()=>{vi.resetAllMocks();h.state=[];h.cursor=0;h.context={data:{sourceRevision:'a'.repeat(64),intents:{items:[intent],hasMore:false}},isError:false,refetch:vi.fn()};h.rpc.mockResolvedValue({error:null});});
it('offers finishing only for a current-session verified intent and uses final native authorization',async()=>{
 const button=nodes(render()).find(n=>text(n.props.children as ReactNode)==='Finish verified package operation')!;
 expect(button.props.disabled).toBe(false);(button.props.onClick as ()=>void)();expect(h.mutate).toHaveBeenCalledWith('operation');
 const options=h.options as {mutationFn:(id:string)=>Promise<void>;onSettled:()=>void};await options.mutationFn('operation');
 expect(h.rpc).toHaveBeenCalledWith('finish_native_learning_package_operation',{p_operation_id:'operation'});options.onSettled();
 expect(h.invalidate).toHaveBeenCalledWith({queryKey:['governed_draft_source']});
 h.context.data={intents:{items:[{...intent,canFinishThisSession:false}],hasMore:false}};
 expect(text(render())).toContain('cannot finish in the current session or draft');
 expect(nodes(render()).some(n=>typeof n.props.onClick==='function'&&text(n.props.children as ReactNode)==='Finish verified package operation')).toBe(false);
});
it('blocks upload and finish while draft edits are unsaved',()=>{
 const tree=render(true);expect(text(tree)).toContain('Save or discard');
 expect(nodes(tree).find(n=>n.props['aria-label']==='Original course package')?.props.disabled).toBe(true);
 expect(nodes(tree).find(n=>text(n.props.children as ReactNode)==='Finish verified package operation')?.props.disabled).toBe(true);
});
it('a failed current-authority refresh disables finishing stale listed intent data',()=>{
 h.context.isError=true;const tree=render();
 expect(nodes(tree).find(n=>text(n.props.children as ReactNode)==='Finish verified package operation')?.props.disabled).toBe(true);
 expect(nodes(tree).find(n=>n.props['aria-label']==='Original course package')?.props.disabled).toBe(true);
});
it('uploads selected standard to this course without any facility or source path parameter',()=>{
 const tree=render();const select=nodes(tree).find(n=>n.type==='select')!;
 (select.props.onChange as (event:unknown)=>void)({target:{value:'xapi'}});
 const input=nodes(render()).find(n=>n.props['aria-label']==='Original course package')!;const file=new File(['zip'],'course.zip');
 (input.props.onChange as (event:unknown)=>void)({target:{files:[file],value:'course.zip'}});
 expect(h.upload).toHaveBeenCalledWith({file,versionId:'version',standard:'xapi'});
 expect(h.query.mock.calls[0][0].queryKey).toEqual(['learning_package_context','actor','version']);
});
