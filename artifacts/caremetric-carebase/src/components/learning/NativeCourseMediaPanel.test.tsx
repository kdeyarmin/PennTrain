import type {ReactElement,ReactNode} from 'react';
import {beforeEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({state:[] as unknown[],cursor:0,ref:{current:null as unknown},context:{data:null as unknown,error:null as unknown,isLoading:false,refetch:vi.fn()},call:vi.fn(),finish:vi.fn(),invalidate:vi.fn()}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),useRef:()=>h.ref,useState:(value:unknown)=>{const i=h.cursor++;if(!(i in h.state))h.state[i]=value;return [h.state[i],(next:unknown)=>{h.state[i]=next;}];}}));
vi.mock('@tanstack/react-query',()=>({useQueryClient:()=>({invalidateQueries:h.invalidate})}));
vi.mock('@/hooks/useCourseMedia',()=>({useCourseMediaContext:()=>h.context,useFinishCourseMedia:()=>({isPending:false,mutateAsync:h.finish}),callCourseMedia:(...args:unknown[])=>h.call(...args)}));
import {NativeCourseMediaPanel} from './NativeCourseMediaPanel';
type Node=ReactElement<Record<string,unknown>>;
function nodes(node:ReactNode):Node[]{if(Array.isArray(node))return node.flatMap(nodes);if(!node||typeof node!=='object'||!('props'in node))return [];const n=node as Node;return[n,...nodes(n.props.children as ReactNode)];}
function text(node:ReactNode):string{if(typeof node==='string'||typeof node==='number')return String(node);if(Array.isArray(node))return node.map(text).join('');return node&&typeof node==='object'&&'props'in node?text((node as Node).props.children as ReactNode):'';}
const id=(n:number)=>`23550000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function render(locked=false){h.cursor=0;return NativeCourseMediaPanel({versionId:id(1),blockId:id(2),type:'pdf',locked});}
function button(label:string){return nodes(render()).find(n=>text(n.props.children as ReactNode)===label&&typeof n.props.onClick==='function')!;}
const intent={operationId:id(3),fileName:'Original.pdf',byteSize:20,state:'staged',reason:'Reviewed PDF bytes',canFinishThisSession:true};
beforeEach(()=>{vi.resetAllMocks();h.state=[];h.cursor=0;h.ref.current=null;h.context={data:{sourceRevision:'a'.repeat(64),block:{generationState:'none',mediaAsset:null},intents:{items:[intent],hasMore:false}},error:null,isLoading:false,refetch:vi.fn()};h.finish.mockResolvedValue({});});
it('explicitly finishes only original current-session verified uploads',async()=>{
 await (button('Attach verified media').props.onClick as ()=>Promise<void>)();expect(h.finish).toHaveBeenCalledWith(id(3));
 h.context.data={...(h.context.data as object),intents:{items:[{...intent,canFinishThisSession:false}],hasMore:false}};
 expect(text(render())).toContain('cannot be attached in the current session');expect(button('Attach verified media')).toBeUndefined();
});
it('locked drafts hide upload and finish and failed refresh disables stale authority',()=>{
 expect(text(render(true))).not.toContain('Upload for review');expect(text(render(true))).not.toContain('Attach verified media');
 h.context.error=new Error('Current authority unavailable');expect(button('Attach verified media').props.disabled).toBe(true);
});
function choose(file:File){const input=nodes(render()).find(n=>n.props.type==='file')!;(input.props.onChange as (event:unknown)=>void)({target:{files:[file]}});
 const reason=nodes(render()).find(n=>n.props.id===`media-reason-${id(2)}`)!;(reason.props.onChange as(event:unknown)=>void)({target:{value:'Reviewed original PDF'}});}
it('rejects over-limit files before hashing or network',async()=>{
 const file=new File(['x'],'large.pdf',{type:'application/pdf'});Object.defineProperty(file,'size',{value:26_214_401});choose(file);
 (button('Upload for review').props.onClick as ()=>void)();await vi.waitFor(()=>expect(h.state[2]).toBe(false));expect(h.call).not.toHaveBeenCalled();expect(text(render())).toContain('size limit');
});
it('retains request identity after uncertainty and never treats malformed stage response as attached',async()=>{
 choose(new File(['%PDF-1.7 synthetic'],'Original.pdf',{type:'application/pdf'}));
 h.call.mockRejectedValueOnce(new Error('Response lost')).mockImplementationOnce(async operation=>({state:'staged',operationId:id(3),assetId:id(4),versionId:operation.versionId,blockId:id(9),contentSha256:operation.sourceSha256,mimeType:operation.mimeType,byteSize:operation.sourceBytes,fileName:operation.fileName}));
 (button('Upload for review').props.onClick as ()=>void)();await vi.waitFor(()=>expect(h.state[2]).toBe(false));expect(h.call).toHaveBeenCalledTimes(1);
 const first=h.call.mock.calls[0][0];(button('Upload for review').props.onClick as ()=>void)();await vi.waitFor(()=>expect(h.state[2]).toBe(false));
 expect(h.call.mock.calls[1][0]).toEqual(first);expect(h.finish).not.toHaveBeenCalled();expect(text(render())).toContain('Invalid course media response');
});
