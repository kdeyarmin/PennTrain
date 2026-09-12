begin;
select no_plan();
select ok(not has_column_privilege('authenticated','public.course_blocks','media_asset_id','INSERT'),'browser cannot attach raw media');
select ok(not has_column_privilege('service_role','public.course_blocks','media_asset_id','UPDATE'),'service cannot replace raw media');
select ok(has_column_privilege('authenticated','public.course_blocks','body','UPDATE'),'existing authored body writes keep privilege');
select ok(not has_table_privilege('service_role','app_private.course_media_assets','INSERT'),'asset provenance has no raw service grant');
select ok(not has_function_privilege('authenticated','public.record_course_media_artifact(uuid,text,integer,text)','EXECUTE'),'browser cannot assert verified bytes');
select ok(not has_function_privilege('anon','public.get_native_course_media_read(uuid,uuid,uuid)','EXECUTE'),'anonymous media reads denied');
select ok(not has_any_column_privilege('service_role','public.course_blocks','UPDATE'),'service retains its original INSERT-only block access');
select ok((select bool_and(has_column_privilege('authenticated','public.course_blocks',column_name,privilege))
 from unnest(array['id','course_version_id','organization_id','block_type','sort_order','title','body','document_id','video_url','created_at']) column_name
 cross join unnest(array['INSERT','UPDATE']) privilege),'all historical browser columns retain exactly their authoring commands');
select ok((select bool_and(has_column_privilege('service_role','public.course_blocks',column_name,'INSERT'))
 from unnest(array['id','course_version_id','organization_id','block_type','sort_order','title','body','document_id','video_url','created_at']) column_name),'all historical service INSERT columns remain usable');
insert into public.organizations(id,name,slug,subscription_status) values
 ('23550000-0000-4000-8000-000000000010','Media fixture','media-ingestion-fixture','active'),
 ('23550000-0000-4000-8000-000000000011','Other media fixture','media-ingestion-other','active');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
 created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,'x',now(),'{}','{}',now(),now(),'','','','','','',false,false
from (values ('23550000-0000-4000-8000-000000000001'::uuid,'media-operator@test.local'),
 ('23550000-0000-4000-8000-000000000002'::uuid,'media-trainer@test.local')) fixture(id,email);
select set_config('app.privileged_write','on',true);
update public.profiles set role='platform_admin',is_active=true where id='23550000-0000-4000-8000-000000000001';
update public.profiles set role='trainer',is_active=true,organization_id='23550000-0000-4000-8000-000000000010' where id='23550000-0000-4000-8000-000000000002';
select set_config('app.privileged_write','',true);
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('23550000-0000-4000-8000-000000000003','23550000-0000-4000-8000-000000000001',now()-interval '1 hour',now(),'aal2'),
 ('23550000-0000-4000-8000-000000000004','23550000-0000-4000-8000-000000000002',now()-interval '1 hour',now(),'aal2'),
 ('23550000-0000-4000-8000-000000000005','23550000-0000-4000-8000-000000000001',now()-interval '1 minute',now(),'aal2');
insert into public.courses(id,organization_id,title,status,created_by) values
 ('23550000-0000-4000-8000-000000000020',null,'Global media draft','draft','23550000-0000-4000-8000-000000000001'),
 ('23550000-0000-4000-8000-000000000021','23550000-0000-4000-8000-000000000010','Tenant media draft','draft','23550000-0000-4000-8000-000000000001'),
 ('23550000-0000-4000-8000-000000000022','23550000-0000-4000-8000-000000000011','Other tenant draft','draft','23550000-0000-4000-8000-000000000001');
insert into public.course_versions(id,course_id,organization_id,version_number,title,status) values
 ('23550000-0000-4000-8000-000000000030','23550000-0000-4000-8000-000000000020',null,1,'Global version','draft'),
 ('23550000-0000-4000-8000-000000000031','23550000-0000-4000-8000-000000000021','23550000-0000-4000-8000-000000000010',1,'Tenant version','draft'),
 ('23550000-0000-4000-8000-000000000032','23550000-0000-4000-8000-000000000022','23550000-0000-4000-8000-000000000011',1,'Other version','draft');


insert into public.course_blocks(id,course_version_id,organization_id,block_type,title,sort_order) values
 ('23550000-0000-4000-8000-000000000050','23550000-0000-4000-8000-000000000030',null,'pdf','Global PDF',1),
 ('23550000-0000-4000-8000-000000000051','23550000-0000-4000-8000-000000000030',null,'video','Global video',2),
 ('23550000-0000-4000-8000-000000000052','23550000-0000-4000-8000-000000000031','23550000-0000-4000-8000-000000000010','pdf','Tenant PDF',1),
 ('23550000-0000-4000-8000-000000000053','23550000-0000-4000-8000-000000000032','23550000-0000-4000-8000-000000000011','pdf','Other PDF',1);
select is(app_private.learning_source_payload('23550000-0000-4000-8000-000000000020','23550000-0000-4000-8000-000000000030'),
 app_private.learning_source_payload_before_media('23550000-0000-4000-8000-000000000020','23550000-0000-4000-8000-000000000030'),'old global source bytes are identical');
create temporary table media_fixture(label text primary key,value jsonb);
grant all on media_fixture to authenticated,service_role;
create function pg_temp.media_actor(p_trainer boolean default false,p_new_session boolean default false) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','aal','aal2','iat',extract(epoch from now())::bigint,'sub',
 case when p_trainer then '23550000-0000-4000-8000-000000000002' else '23550000-0000-4000-8000-000000000001' end,
 'session_id',case when p_trainer then '23550000-0000-4000-8000-000000000004' when p_new_session then '23550000-0000-4000-8000-000000000005' else '23550000-0000-4000-8000-000000000003' end)::text,true);
$$;
create function pg_temp.media_request(p_id uuid,p_block uuid default '23550000-0000-4000-8000-000000000050',p_mime text default 'application/pdf') returns jsonb language sql as $$
 select jsonb_build_object('operation','media.upload','requestId',p_id,'versionId','23550000-0000-4000-8000-000000000030','blockId',p_block,
 'sourceRevision',public.get_native_course_media_context('23550000-0000-4000-8000-000000000030',p_block)->>'sourceRevision',
 'reason','Synthetic media attachment review','fileName','Synthetic original.pdf','mimeType',p_mime,'sourceSha256',repeat('a',64),'sourceBytes',128);
$$;
set local role authenticated;
select pg_temp.media_actor();
insert into media_fixture values('request',pg_temp.media_request('23550000-0000-4000-8000-000000000040'));
insert into media_fixture values('plan',public.prepare_native_course_media_operation((select value from media_fixture where label='request')));
select ok((select value->>'storagePath' like 'global/23550000-0000-4000-8000-000000000020/%' from media_fixture where label='plan'),'global media is course-owned without facility path');
select is(public.prepare_native_course_media_operation((select value from media_fixture where label='request')),(select value from media_fixture where label='plan'),'exact prepare replays same immutable identity');
select throws_ok($$select public.finish_native_course_media_operation((select (value->>'operationId')::uuid from media_fixture where label='plan'))$$,'42501',null,'no byte evidence means no attachment');
select throws_ok($$select public.prepare_native_course_media_operation((select value||'{"storagePath":"foreign/file.pdf"}'::jsonb from media_fixture where label='request'))$$,'22023',null,'no foreign path picker');
select throws_ok($$select public.prepare_native_course_media_operation((select value||jsonb_build_object('fileName',chr(160)||'name.pdf') from media_fixture where label='request'))$$,'22023',null,'Unicode leading whitespace matches protocol rejection');
select throws_ok($$select public.prepare_native_course_media_operation((select value||jsonb_build_object('fileName','name'||chr(129)||'.pdf') from media_fixture where label='request'))$$,'22023',null,'C1 filename controls rejected');
select throws_ok($$select public.prepare_native_course_media_operation((select value||'{"sourceBytes":"128"}'::jsonb from media_fixture where label='request'))$$,'22023',null,'numeric string bytes rejected');
select throws_ok($$select public.prepare_native_course_media_operation((select value||'{"sourceBytes":26214401}'::jsonb from media_fixture where label='request'))$$,'22023',null,'PDF bound enforced in SQL');
select throws_ok($$select public.prepare_native_course_media_operation((select value||'{"reason":"Changed immutable request"}'::jsonb from media_fixture where label='request'))$$,'40001',null,'same request binds exact reason');
reset role;
select is((select media_asset_id from public.course_blocks where id='23550000-0000-4000-8000-000000000050'),null::uuid,'prepare leaves existing block intact');
insert into storage.objects(bucket_id,name,metadata) select 'course-media',value->>'storagePath','{"size":128}'::jsonb from media_fixture where label='plan';
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select public.record_course_media_artifact((select (value->>'operationId')::uuid from media_fixture where label='plan'),repeat('a',64),128,'application/pdf');
select throws_ok($$select public.record_course_media_artifact((select (value->>'operationId')::uuid from media_fixture where label='plan'),repeat('b',64),128,'application/pdf')$$,'42501',null,'different byte evidence rejected');
set local role authenticated;
select pg_temp.media_actor(false,true);
select is(public.get_native_course_media_status((select (value->>'operationId')::uuid from media_fixture where label='plan'))->>'canFinishThisSession','false','fresh session has read-only recovery');
select throws_ok($$select public.finish_native_course_media_operation((select (value->>'operationId')::uuid from media_fixture where label='plan'))$$,'42501',null,'fresh session cannot adopt original write');
select pg_temp.media_actor();
select is(public.get_native_course_media_context('23550000-0000-4000-8000-000000000030','23550000-0000-4000-8000-000000000050')->'intents'->'items'->0->>'canFinishThisSession','true','original session sees verified upload ready');
reset role;
select set_config('app.privileged_write','on',true);
update public.profiles set is_active=false where id='23550000-0000-4000-8000-000000000001';
select set_config('app.privileged_write','',true);
set local role authenticated;
select pg_temp.media_actor();
select throws_ok($$select public.finish_native_course_media_operation((select (value->>'operationId')::uuid from media_fixture where label='plan'))$$,'42501',null,'revocation after upload prevents attachment');
reset role;
select is((select count(*) from app_private.course_media_assets),0::bigint,'revoked finish does not create asset');
select set_config('app.privileged_write','on',true);
update public.profiles set is_active=true where id='23550000-0000-4000-8000-000000000001';
select set_config('app.privileged_write','',true);
set local role authenticated;
select pg_temp.media_actor();
insert into media_fixture values('receipt',public.finish_native_course_media_operation((select (value->>'operationId')::uuid from media_fixture where label='plan')));
select is(public.finish_native_course_media_operation((select (value->>'operationId')::uuid from media_fixture where label='plan')),(select value from media_fixture where label='receipt'),'lost finish response returns exact receipt');
select is(public.prepare_native_course_media_operation((select value from media_fixture where label='request'))->'result',(select value from media_fixture where label='receipt'),'lost stage response replays committed receipt');
select isnt((select value->>'sourceRevision' from media_fixture where label='receipt'),(select value->>'sourceRevision' from media_fixture where label='request'),'receipt records changed canonical source');
select lives_ok($$select public.get_native_course_media_read('23550000-0000-4000-8000-000000000030','23550000-0000-4000-8000-000000000050',(select (value->>'assetId')::uuid from media_fixture where label='receipt'))$$,'authorized admin can read exact attached asset');
select throws_ok($$select public.get_native_course_media_read('23550000-0000-4000-8000-000000000030','23550000-0000-4000-8000-000000000051',(select (value->>'assetId')::uuid from media_fixture where label='receipt'))$$,'P0002',null,'asset cannot be read through another block');
reset role;
select is((select count(*) from public.audit_logs where action='course_media_attached' and entity_id='23550000-0000-4000-8000-000000000050'),1::bigint,'one attachment audit across lost responses');
select is((select value->>'sourceRevision' from media_fixture where label='receipt'),app_private.learning_package_revision('23550000-0000-4000-8000-000000000030'),'receipt SHA equals exact current source');
select is((app_private.learning_source_payload('23550000-0000-4000-8000-000000000020','23550000-0000-4000-8000-000000000030')::jsonb->'blocks'->0->'mediaAsset'->>'id'),(select value->>'assetId' from media_fixture where label='receipt'),'governed snapshot carries safe immutable asset');
select ok(app_private.course_media_ready('23550000-0000-4000-8000-000000000050'),'verified PDF satisfies media publication evidence');
select throws_ok($$update app_private.course_media_assets set file_name='replacement.pdf'$$,'42501',null,'asset evidence immutable');
select throws_ok($$delete from app_private.course_media_artifacts$$,'42501',null,'verified proof cannot be erased');
select throws_ok($$update public.course_blocks set media_asset_id=(select (value->>'assetId')::uuid from media_fixture where label='receipt') where id='23550000-0000-4000-8000-000000000053'$$,'42501',null,'even a trusted writer cannot attach another course asset');
set local role authenticated;
select pg_temp.media_actor(true);
select throws_ok($$select public.get_native_course_media_context('23550000-0000-4000-8000-000000000030','23550000-0000-4000-8000-000000000050')$$,'42501',null,'trainer cannot inspect global authoring state');
select throws_ok($$select public.get_native_course_media_context('23550000-0000-4000-8000-000000000032','23550000-0000-4000-8000-000000000053')$$,'42501',null,'trainer cannot inspect foreign authoring state');
select lives_ok($$select public.get_native_course_media_context('23550000-0000-4000-8000-000000000031','23550000-0000-4000-8000-000000000052')$$,'same-tenant authoring retains authority');
select pg_temp.media_actor();
insert into media_fixture values('stale',public.prepare_native_course_media_operation(pg_temp.media_request('23550000-0000-4000-8000-000000000041')));
reset role;
insert into storage.objects(bucket_id,name,metadata) select 'course-media',value->>'storagePath','{"size":128}'::jsonb from media_fixture where label='stale';
update public.course_blocks set title='A separately edited title' where id='23550000-0000-4000-8000-000000000050';
set local role service_role;
select public.record_course_media_artifact((select (value->>'operationId')::uuid from media_fixture where label='stale'),repeat('a',64),128,'application/pdf');
set local role authenticated;
select pg_temp.media_actor();
select throws_ok($$select public.finish_native_course_media_operation((select (value->>'operationId')::uuid from media_fixture where label='stale'))$$,'40001',null,'source drift prevents replacement after upload');
reset role;
select is((select media_asset_id::text from public.course_blocks where id='23550000-0000-4000-8000-000000000050'),(select value->>'assetId' from media_fixture where label='receipt'),'failed CAS preserves prior immutable media');

-- An actual common clone shares immutable course-owned assets, never learner history.
insert into media_fixture values('clone',to_jsonb(app_private.clone_course_version_core('23550000-0000-4000-8000-000000000001',
 '23550000-0000-4000-8000-000000000030','23550000-0000-4000-8000-000000000020',null,2,'Cloned media source')));
select is((select media_asset_id::text from public.course_blocks where course_version_id=(select (value->>'id')::uuid from media_fixture where label='clone') and block_type='pdf'),
 (select value->>'assetId' from media_fixture where label='receipt'),'clone preserves exact original asset identity');
select is((select count(*) from public.course_assignments where course_version_id=(select (value->>'id')::uuid from media_fixture where label='clone')),0::bigint,'clone copies no learner assignments');
set local role authenticated;
select pg_temp.media_actor();
select throws_ok($$select public.admin_emergency_update_course_block('23550000-0000-4000-8000-000000000050','Reviewed emergency text correction',p_title=>'Corrected title')$$,
 '40001',null,'legacy emergency call cannot silently replace attached media');
reset role;
insert into media_fixture values('emergency',jsonb_build_object('block',(select to_jsonb(b) from public.course_blocks b where id='23550000-0000-4000-8000-000000000050'),
 'source',app_private.learning_package_revision('23550000-0000-4000-8000-000000000030')));
set local role authenticated;
select pg_temp.media_actor();
select lives_ok($$select public.admin_emergency_update_course_block('23550000-0000-4000-8000-000000000050','Reviewed emergency text correction',p_title=>'Corrected title',
 p_expected_media_asset_id=>(select (value->>'assetId')::uuid from media_fixture where label='receipt'),
 p_expected_source_revision=>(select value->>'source' from media_fixture where label='emergency'),p_expected_block=>(select value->'block' from media_fixture where label='emergency'))$$,
 'emergency text correction uses reviewed block and source CAS');
select throws_ok($$select public.admin_emergency_update_course_block('23550000-0000-4000-8000-000000000050','Repeated obsolete emergency correction',p_title=>'Another title',
 p_expected_media_asset_id=>(select (value->>'assetId')::uuid from media_fixture where label='receipt'),
 p_expected_source_revision=>(select value->>'source' from media_fixture where label='emergency'),p_expected_block=>(select value->'block' from media_fixture where label='emergency'))$$,
 '40001',null,'stale emergency snapshot cannot overwrite a later correction');
reset role;
select is((select media_asset_id::text from public.course_blocks where id='23550000-0000-4000-8000-000000000050'),(select value->>'assetId' from media_fixture where label='receipt'),'text correction preserves original PDF');
set local role authenticated;
select pg_temp.media_actor();
insert into media_fixture values('video_plan',public.prepare_native_course_media_operation(pg_temp.media_request('23550000-0000-4000-8000-000000000042','23550000-0000-4000-8000-000000000051','video/mp4')||'{"fileName":"Original.mp4"}'::jsonb));
reset role;
insert into storage.objects(bucket_id,name,metadata) select 'course-media',value->>'storagePath','{"size":128}'::jsonb from media_fixture where label='video_plan';
set local role service_role;
select public.record_course_media_artifact((select (value->>'operationId')::uuid from media_fixture where label='video_plan'),repeat('a',64),128,'video/mp4');
set local role authenticated;
select pg_temp.media_actor();
insert into media_fixture values('video_receipt',public.finish_native_course_media_operation((select (value->>'operationId')::uuid from media_fixture where label='video_plan')));
reset role;
create function pg_temp.media_generation(p_request uuid,p_replace boolean,p_expected uuid) returns jsonb language sql as $$
 select public.claim_course_video_generation('23550000-0000-4000-8000-000000000051',p_request,
 '{"type":"avatar","avatar_id":"synthetic_avatar","voice_id":"synthetic_voice","script":"Synthetic narration"}',p_replace,null,p_expected);
$$;
set local role authenticated;
select pg_temp.media_actor();
select throws_ok($$select pg_temp.media_generation('23550000-0000-4000-8000-000000000061',false,(select (value->>'assetId')::uuid from media_fixture where label='video_receipt'))$$,'55000',null,'paid generation requires explicit replacement of an attached asset');
select throws_ok($$select pg_temp.media_generation('23550000-0000-4000-8000-000000000061',true,null)$$,'55000',null,'paid generation cannot compare only an empty legacy URL');
insert into media_fixture values('generation',pg_temp.media_generation('23550000-0000-4000-8000-000000000061',true,(select (value->>'assetId')::uuid from media_fixture where label='video_receipt')));
select throws_ok($$select public.prepare_native_course_media_operation(pg_temp.media_request('23550000-0000-4000-8000-000000000043','23550000-0000-4000-8000-000000000051','video/mp4'))$$,'40001',null,'unresolved paid generation prevents new staged replacement');
reset role;
select is((select media_asset_id::text from public.course_blocks where id='23550000-0000-4000-8000-000000000051'),(select value->>'assetId' from media_fixture where label='video_receipt'),'starting generation preserves usable current media');
set local role service_role;
select public.finish_course_video_submission((select (value->>'attempt_id')::uuid from media_fixture where label='generation'),(select (value->>'lease_id')::uuid from media_fixture where label='generation'),'accepted','synthetic_media_video',null);
reset role;
update public.course_blocks set title='Content edited after generation' where id='23550000-0000-4000-8000-000000000051';
set local role service_role;
select is(public.resolve_course_video_generation('23550000-0000-4000-8000-000000000051','synthetic_media_video',
 (select (value->>'attempt_id')::uuid from media_fixture where label='generation'),null,'completed','storage://course-videos/system/23550000-0000-4000-8000-000000000051.synthetic_media_video.mp4',null)->>'status','stale','late provider response cannot overwrite a changed reviewed source');
reset role;
select is((select media_asset_id::text from public.course_blocks where id='23550000-0000-4000-8000-000000000051'),(select value->>'assetId' from media_fixture where label='video_receipt'),'stale provider completion preserves original video asset');
select ok(app_private.course_media_ready('23550000-0000-4000-8000-000000000051'),'original media remains usable after rejected provider completion');
select is((select count(*) from app_private.course_media_assets),2::bigint,'all original asset evidence remains retained');
select * from finish();
rollback;
