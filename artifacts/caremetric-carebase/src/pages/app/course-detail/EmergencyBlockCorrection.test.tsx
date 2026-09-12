import type { ReactElement, ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { CourseBlock } from '@/hooks/useCourses';
const h=vi.hoisted(()=>({state:[] as unknown[],cursor:0,mutate:vi.fn(),call:vi.fn(),toast:vi.fn()}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),useState:(value:unknown)=>{const i=h.cursor++;if(!(i in h.state))h.state[i]=value;return[h.state[i],(next:unknown)=>{h.state[i]=next;}];}}));
vi.mock('@/hooks/useCourses',()=>({useEmergencyUpdateCourseBlock:()=>({isPending:false,mutate:h.mutate})}));
vi.mock('@/hooks/useCourseMedia',()=>({callCourseMedia:(...args:unknown[])=>h.call(...args)}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:h.toast})}));
import { EmergencyBlockCorrection } from './EmergencyBlockCorrection';
type Node=ReactElement<Record<string,unknown>>;
function nodes(value:ReactNode):Node[]{if(Array.isArray(value))return value.flatMap(nodes);if(!value||typeof value!=='object'||!('props'in value))return[];const node=value as Node;return[node,...nodes(node.props.children as ReactNode)];}
function text(value:ReactNode):string{if(typeof value==='string'||typeof value==='number')return String(value);if(Array.isArray(value))return value.map(text).join('');return value&&typeof value==='object'&&'props'in value?text((value as Node).props.children as ReactNode):'';}
const id=(n:number)=>`23550000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const baseline={id:id(1),course_version_id:id(2),organization_id:null,block_type:'video',title:'Reviewed title',body:{content:'Reviewed text',heygen:{status:'completed',video_id:'prior'}},media_asset_id:id(3),video_url:null,document_id:null,sort_order:0,created_at:'2026-09-11T00:00:00Z'} as CourseBlock;
function render(block=baseline){h.cursor=0;return EmergencyBlockCorrection({block});}
function button(label:string,block=baseline){return nodes(render(block)).find(n=>typeof n.props.onClick==='function'&&text(n.props.children as ReactNode)===label)!;}
function change(suffix:string,value:string){const input=nodes(render()).find(n=>n.props.id===`emergency-${suffix}-${baseline.id}`)!;(input.props.onChange as(event:unknown)=>void)({target:{value}});}
beforeEach(()=>{vi.resetAllMocks();h.state=[];h.cursor=0;h.call.mockResolvedValue({courseId:id(4),versionId:id(2),sourceRevision:'a'.repeat(64),block:{id:id(1),type:'video',title:'Reviewed title',mediaAsset:{id:id(3),contentSha256:'b'.repeat(64),mimeType:'video/mp4',byteSize:100,fileName:'Lesson.mp4'},legacyDocumentId:null,legacyVideoSha256:null,generationState:'settled'},intents:{items:[],hasMore:false}});});
it('retains the reviewed block and media CAS across a background course refresh',async()=>{
 await (button('Emergency correction').props.onClick as()=>Promise<void>)();
 change('content','Corrected reviewed text');change('reason','Correct the reviewed teaching material');
 const refreshed={...baseline,title:'Concurrent title',body:{content:'Concurrent text',heygen:{status:'processing',video_id:'next'}},media_asset_id:id(5)} as CourseBlock;
 const apply=button('Apply correction',refreshed);expect(apply.props.disabled).toBe(false);(apply.props.onClick as()=>void)();
 expect(h.mutate).toHaveBeenCalledOnce();expect(h.mutate.mock.calls[0][0]).toEqual({blockId:id(1),expectedMediaAssetId:id(3),expectedSourceRevision:'a'.repeat(64),expectedBlock:baseline,reason:'Correct the reviewed teaching material',title:'Reviewed title',body:{...baseline.body as object,content:'Corrected reviewed text'}});
});
it('does not open a correction against a different current media asset',async()=>{
 const context=await h.call();h.call.mockResolvedValue({...context,block:{...context.block,mediaAsset:{...context.block.mediaAsset,id:id(5)}}});
 await (button('Emergency correction').props.onClick as()=>Promise<void>)();expect(button('Apply correction')).toBeUndefined();expect(h.mutate).not.toHaveBeenCalled();expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({title:'Could not review the current block',variant:'destructive'}));
});
