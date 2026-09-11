import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {randomBytes,randomUUID} from "node:crypto";
import test from "node:test";
import {createClient} from "@supabase/supabase-js";
import {createCreateBillingSessionHandler} from "../../../supabase/functions/create-billing-session/handler.ts";
import {createPlatformAdminBillingCommandHandler} from "./platform-admin-billing-commands.mjs";

test("real native SMS session and Hub HTTP calls share one provider reservation under concurrency and revocation", {
 skip:process.env.CAREMETRIC_LOCAL_BILLING_READ_TESTS!=="true",timeout:30_000,
},async()=>{
 const url=new URL(process.env.SUPABASE_URL??"");
 assert.ok(["127.0.0.1","localhost","[::1]"].includes(url.hostname),"Checkout fixtures require disposable loopback Supabase");
 const authOptions={persistSession:false,autoRefreshToken:false,detectSessionInUrl:false};
 const native=createClient(url.origin,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:authOptions});
 const anonKey=process.env.SUPABASE_ANON_KEY??process.env.VITE_SUPABASE_ANON_KEY;
 const caller=createClient(url.origin,anonKey,{auth:authOptions});
 const org=randomUUID(),packageId=randomUUID(),priceId=randomUUID(),hubUser=randomUUID(),hubSession=randomUUID(),requestId=randomUUID();
 const suffix=org.replaceAll("-",""),password=randomUUID()+"Aa1!",email=`checkout-${suffix}@fixture.test`;
 const sql=input=>execFileSync("docker",["exec","-i","supabase_db_xsqobvvreaovwibxwyvv","psql","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1","-At"],
   {input,encoding:"utf8",stdio:["pipe","pipe","pipe"]}).trim();
 const rpc=async(client,name,args)=>{const result=await client.rpc(name,args);assert.equal(result.error,null,`Synthetic RPC ${name}: ${result.error?.code??""}`);return result.data;};
 const created=await native.auth.admin.createUser({email,email_confirm:true,password});assert.equal(created.error,null);
 const actor=created.data.user.id;
 await rpc(native,"admin_update_profile",{p_user_id:actor,p_role:"platform_admin",p_is_active:true});
 sql(`begin;
 insert into public.organizations(id,name,slug,subscription_status) values('${org}','Checkout HTTP fixture','checkout-http-${suffix}','active');
 update public.billing_accounts set stripe_customer_id='cus_${suffix}' where organization_id='${org}';
 insert into public.packages(id,name,is_active,trial_days) values('${packageId}','Checkout HTTP package',true,0);
 insert into public.package_billing_prices(id,package_id,stripe_price_id,currency,recurring_interval,interval_count,billing_metric,pricing_model,minimum_quantity,is_active,is_primary)
 values('${priceId}','${packageId}','price_${suffix}','usd','month',1,'flat','flat',1,true,true);
 commit;`);
 const signed=await caller.auth.signInWithPassword({email,password});assert.equal(signed.error,null);
 const token=signed.data.session.access_token,claims=JSON.parse(Buffer.from(token.split(".")[1],"base64url").toString());
 assert.equal(claims.aal,"aal1","this fixture uses a real password session plus native SMS proof");
 // Actual SMS state-machine RPCs; only provider approval is synthetic. No SMS or provider network is used.
 const challenge=await rpc(native,"prepare_sms_mfa_challenge",{p_profile_id:actor,p_session_id:claims.session_id,p_phone:"+15555550101",p_native_aal2:false});
 await rpc(native,"activate_sms_mfa_challenge",{p_profile_id:actor,p_session_id:claims.session_id,p_challenge_id:challenge.challengeId,p_verification_sid:"VE"+suffix});
 const attempt=await rpc(native,"reserve_sms_mfa_check",{p_profile_id:actor,p_session_id:claims.session_id,p_challenge_id:challenge.challengeId});
 await rpc(native,"complete_sms_mfa_check",{p_profile_id:actor,p_session_id:claims.session_id,p_challenge_id:challenge.challengeId,p_attempt_id:attempt.attemptId,p_approved:true});
 assert.equal(await rpc(caller,"identity_assurance_is_current",{p_operation:"billing_admin"}),true);
 const providerCalls=[],tickets=new Map();let providerValues,releasePost,announcePost,revokeAfterGet=false;
 const postStarted=new Promise(resolve=>{announcePost=resolve;}),postRelease=new Promise(resolve=>{releasePost=resolve;});
 const provider=()=>({id:`cs_test_${suffix}`,mode:"subscription",client_reference_id:org,customer:`cus_${suffix}`,subscription:null,status:"open",
   metadata:providerValues.metadata,livemode:false,expires_at:Math.floor(Date.now()/1000)+3600,url:`https://checkout.stripe.com/c/pay/cs_test_${suffix}#safe%2Ffragment`,
   line_items:{has_more:false,data:[{price:{active:true,livemode:false,type:"recurring",id:`price_${suffix}`,currency:"usd",recurring:{interval:"month",interval_count:1}},quantity:1}]}});
 const stripePost=async(path,_key,values,key)=>{providerCalls.push({method:"POST",path,key});providerValues=values;announcePost();await postRelease;return {ok:true,status:200,data:provider()};};
 const stripeGet=async path=>{providerCalls.push({method:"GET",path});assert.equal(path,`/v1/checkout/sessions/cs_test_${suffix}?expand%5B%5D=line_items`);
   if(revokeAfterGet) await rpc(native,"admin_update_profile",{p_user_id:actor,p_is_active:false});
   return {ok:true,status:200,data:provider()};};
 const env={SUPABASE_URL:url.origin,SUPABASE_ANON_KEY:anonKey,SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY,
   STRIPE_SECRET_KEY:"sk_test_fixture",STRIPE_BILLING_WEBHOOK_SECRET:"fixture-not-used",PUBLIC_APP_URL:"https://cmcarebase.com"};
 const nativeHandler=createCreateBillingSessionHandler({createClient,stripePost,stripeGet,getEnv:name=>env[name]});
 const started=new Date(Date.now()-60_000),actorAuthority={user_id:hubUser,role:"platform_admin",method:"sms",session_id:hubSession,
   session_started_at:started.toISOString(),assurance_expires_at:new Date(started.getTime()+480*60_000).toISOString()};
 const hubHandler=createPlatformAdminBillingCommandHandler({config:{enabled:true,commandsEnabled:true,billingCommandsEnabled:true,checkoutCommandsEnabled:true,
   stripeKey:env.STRIPE_SECRET_KEY,identities:new Map([[hubUser,actor]]),supabaseUrl:url.origin,serviceKey:env.SUPABASE_SERVICE_ROLE_KEY},
   stripePost,stripeGet,getEnv:name=>env[name],fetcher:async(input,init)=>{
     const target=new URL(input instanceof Request?input.url:input);
     if(target.href==="https://support-hub-web-production.up.railway.app/api/internal/command/carebase/authorize") {
       const ticket=new Headers(init.headers).get("authorization"),operation=tickets.get(ticket);tickets.delete(ticket);
       return operation?Response.json({...actorAuthority,operation}):Response.json({}, {status:401});
     }
     assert.equal(target.origin,url.origin,"fixture cannot contact an external provider");return fetch(input,init);
   }});
 const send=async operation=>{
   const ticket=`Bearer cmh_${randomBytes(32).toString("base64url")}`;tickets.set(ticket,operation);
   return hubHandler(new Request("https://cmcarebase.com/api/platform-admin/billing/command",{method:"POST",
     headers:{authorization:ticket,"content-type":"application/json"},body:JSON.stringify(operation)}));
 };
 const previewRequest={operation:"preview",action:"billing.checkout.create",requestId,targetId:org,reason:"Reviewed synthetic concurrent Checkout",parameters:{packageId,billingInterval:"month"}};
 const previewResponse=await send(previewRequest);assert.equal(previewResponse.status,200);const preview=(await previewResponse.json()).data;
 const apply={operation:"apply",action:previewRequest.action,commandId:preview.commandId,expectedDigest:preview.previewDigest};
 const body={action:"checkout",organizationId:org,packageId,billingInterval:"month",successUrl:"https://cmcarebase.com/admin/enterprise?billing=success",cancelUrl:"https://cmcarebase.com/admin/enterprise?billing=cancelled",idempotencyKey:randomUUID()};
 const pendingNative=nativeHandler(new Request(url.origin+"/functions/v1/create-billing-session",{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify(body)}));
 // Surface an early HTTP failure instead of hiding it behind an unresolved provider wait.
 await Promise.race([postStarted,pendingNative.then(async response=>{throw new Error(`Native checkout stopped before synthetic provider: ${response.status} ${(await response.json()).error?.code}`);})]);
 try {
   const racing=await Promise.all([send(apply),send(apply)]);
   for(const response of racing) {assert.equal(response.status,200);const data=(await response.json()).data;assert.equal(data.outcome,"pending");assert.equal(data.session,null);}
   assert.equal(providerCalls.filter(call=>call.method==="POST").length,1);
   assert.equal(sql(`select count(*) from app_private.checkout_reservations where organization_id='${org}'`),"1");
 } finally {releasePost();}
 const nativeResponse=await pendingNative;assert.equal(nativeResponse.status,200);assert.equal((await nativeResponse.json()).data.sessionId,`cs_test_${suffix}`);
 const checked=await send({...apply,operation:"check"});assert.equal(checked.status,200);assert.equal((await checked.json()).data.outcome,"open");
 assert.equal(providerCalls.filter(call=>call.method==="POST").length,1,"Hub checks never create another session");
 revokeAfterGet=true;
 const denied=await send({...apply,operation:"check"});assert.equal(denied.status,403);assert.equal((await denied.text()).includes("checkout.stripe.com"),false);
 assert.equal(sql(`select state from app_private.checkout_reservations where organization_id='${org}'`),"open","successful provider evidence persists despite later actor revocation");
 assert.equal(sql(`select count(*) from public.audit_logs where entity_type='checkout_reservation' and organization_id='${org}' and to_jsonb(audit_logs)::text like '%checkout.stripe.com%'`),"0");
 // Immutable synthetic evidence remains until CI stops this disposable stack without backup.
});
