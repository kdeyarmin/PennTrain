import assert from "node:assert/strict";
import test from "node:test";
import {createPlatformAdminBillingCommandHandler,parseBillingCommand} from "./platform-admin-billing-commands.mjs";
import {readPlatformAdminConfig} from "./platform-admin-auth.mjs";
import {projectBillingCatalog} from "./platform-admin-billing-catalog.mjs";

const HUB="11111111-1111-4111-8111-111111111111", ACTOR="22222222-2222-4222-8222-222222222222", SESSION="33333333-3333-4333-8333-333333333333";
const ORG="44444444-4444-4444-8444-444444444444", PACKAGE="55555555-5555-4555-8555-555555555555", COMMAND="66666666-6666-4666-8666-666666666666";
const RESERVATION="77777777-7777-4777-8777-777777777777", LEASE="88888888-8888-4888-8888-888888888888", NOW="2026-09-11T20:00:00.000Z", DIGEST="a".repeat(64);
const preview={operation:"preview",action:"billing.checkout.create",requestId:COMMAND,targetId:ORG,parameters:{packageId:PACKAGE,billingInterval:"month"},reason:"Reviewed synthetic Checkout plan"};
const apply={operation:"apply",action:preview.action,commandId:COMMAND,expectedDigest:DIGEST};
const recover={operation:"recover",action:"billing.checkout.recover",requestId:COMMAND,targetId:ORG,reason:"Inspect original Checkout after signing in"};
const values={mode:"subscription",client_reference_id:ORG,customer:"cus_fixture",payment_method_collection:"always",success_url:"https://cmcarebase.com/admin/enterprise?billing=success",
 cancel_url:"https://cmcarebase.com/admin/enterprise?billing=cancelled",line_items:[{price:"price_fixture",quantity:1}],metadata:{organization_id:ORG,package_id:PACKAGE,billing_metric:"flat",billing_interval:"month",billable_quantity_source:"database_snapshot"}};
values.subscription_data={metadata:values.metadata};
function fixture(overrides={}) {
 const calls=[],providerCalls=[];
 const state={actor:{user_id:HUB,role:"platform_admin",aal:"aal2",session_id:SESSION,session_started_at:"2026-09-11T19:00:00Z",assurance_expires_at:"2026-09-12T03:00:00Z"},
  profile:{id:ACTOR,role:"platform_admin",is_active:true},...overrides};
 const env={CAREMETRIC_ADMIN_ENABLED:"true",CAREMETRIC_ADMIN_COMMANDS_ENABLED:"true",CAREMETRIC_ADMIN_BILLING_COMMANDS_ENABLED:"true",CAREMETRIC_ADMIN_CHECKOUT_COMMANDS_ENABLED:"true",
  HUB_SUPABASE_URL:"https://hub.test",HUB_SUPABASE_PUBLISHABLE_KEY:"sb_publishable_fixture",SUPABASE_URL:"https://native.test",SUPABASE_SERVICE_ROLE_KEY:"sb_secret_fixture",
  STRIPE_SECRET_KEY:"sk_test_fixture",STRIPE_BILLING_WEBHOOK_SECRET:"whsec_fixture",PUBLIC_APP_URL:"https://cmcarebase.com",CAREMETRIC_ADMIN_IDENTITY_MAP_JSON:JSON.stringify({[HUB]:ACTOR}),...state.env};
 const price={stripe_price_id:"price_fixture",currency:"usd",interval_count:1,billing_metric:"flat",pricing_model:"flat",minimum_quantity:1,maximum_quantity:null,packages:{is_active:true,trial_days:0}};
 const source={id:COMMAND,action:preview.action,targetId:ORG,reason:preview.reason,expiresAt:"2026-09-11T20:05:00Z",previewDigest:DIGEST,
  summary:{kind:"checkout",organizationName:"Synthetic organization",packageId:PACKAGE,billingInterval:"month",intervalCount:1,currency:"usd",billingMetric:"flat",quantity:1,providerPriceId:"price_fixture",providerCustomerId:"cus_fixture",trialDays:0}};
 const provider={id:"cs_test_fixture",mode:"subscription",client_reference_id:ORG,customer:"cus_fixture",subscription:null,status:"open",metadata:values.metadata,livemode:false,
  expires_at:Math.floor(Date.parse(NOW)/1000)+3600,url:"https://checkout.stripe.com/c/pay/cs_test_fixture#safe%2Ffragment",
  line_items:{has_more:false,data:[{price:{active:true,livemode:false,type:"recurring",id:"price_fixture",currency:"usd",recurring:{interval:"month",interval_count:1}},quantity:1}]}};
 const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json"}});
 const fetcher=async(input,init={})=>{
  const url=new URL(input instanceof Request?input.url:input),body=init.body?JSON.parse(init.body):null;calls.push({path:url.pathname,body});
  assert.equal(init.redirect,"error");assert.ok(init.signal instanceof AbortSignal);
  if(url.origin==="https://hub.test") return json(state.actor);
  if(url.origin==="https://support-hub-web-production.up.railway.app") return json(state.sms);
  if(url.pathname.startsWith("/auth/v1/admin/users/")) return json({user:{id:ACTOR}});
  if(url.pathname==="/rest/v1/profiles") return json([state.profile]);
  if(url.pathname==="/rest/v1/billing_accounts") return json([{id:COMMAND,stripe_customer_id:"cus_fixture",billing_state:"active"}]);
  if(url.pathname==="/rest/v1/billing_subscriptions") return json([]);
  if(url.pathname==="/rest/v1/package_billing_prices") return json([price]);
  if(url.pathname==="/rest/v1/organizations") return json([{trial_ends_at:null}]);
  if(url.pathname.endsWith("/platform_admin_preview_checkout")) {
    assert.deepEqual(body.p_provider_parameters,values);assert.equal(body.p_source_snapshot.price.currency,"usd");
    return json({commandId:source.id,...Object.fromEntries(Object.entries(source).filter(([key])=>key!=="id"))});
  }
  if(url.pathname.endsWith("/platform_admin_recover_checkout")) {
    state.recovered=true;
    return json({preview:state.noReservation?null:{commandId:source.id,...Object.fromEntries(Object.entries(source).filter(([key])=>key!=="id")),
      action:recover.action,reason:body.p_reason,expiresAt:state.recoveryExpiry??source.expiresAt},canStartNewCheckout:state.canStart??false});
  }
  if(url.pathname.endsWith("/platform_admin_claim_checkout")) return json(state.result ? {kind:"result",data:state.result} : {kind:body.p_check_only?"check":"create",commandId:COMMAND,targetId:ORG,reservationId:RESERVATION,leaseId:LEASE,
    idempotencyKey:`carebase:checkout:${RESERVATION}`,values,priorSession:body.p_check_only?{id:provider.id,customerId:provider.customer}:null,replayed:body.p_check_only,
    firstDispatch:!body.p_check_only,priceConfiguration:price});
  if(url.pathname.endsWith("/finish_checkout_reservation")) {state.finish=body;return new Response(null,{status:204});}
  if(url.pathname.endsWith("/platform_admin_read_checkout_result")) {
    if(state.revoked) return json({code:"42501"},403);
    if(state.result) return json(state.result);
    const finished=state.finish,s=finished.p_session,outcome=finished.p_outcome==="indeterminate"?"pending":finished.p_outcome;
    return json({commandId:COMMAND,action:state.recovered?recover.action:preview.action,targetId:ORG,outcome,replayed:body.p_replayed,checkedAt:outcome==="pending"?null:NOW,
      providerStatus:s?.status??null,availability:outcome==="pending"?"unavailable":"available",canStartNewCheckout:false,retryAfterSeconds:outcome==="pending"?30:null,
      session:outcome==="open"?{kind:"checkout",id:s.id,url:s.url,expiresAt:s.expiresAt,livemode:s.livemode}:null});
  }
  throw Error("Unexpected synthetic path");
 };
 const handler=createPlatformAdminBillingCommandHandler({config:readPlatformAdminConfig(k=>env[k]),getEnv:k=>env[k],fetcher,now:()=>new Date(NOW),
  stripePost:async(path,_key,parameters,key)=>{providerCalls.push({method:"POST",path,key});assert.deepEqual(parameters,values);return {ok:true,status:200,data:provider};},
  stripeGet:async path=>{providerCalls.push({method:"GET",path});if(state.revokeAfterGet) state.revoked=true;return {ok:true,status:200,data:{...provider,...state.providerOverride}};}});
 const request=(operation=preview,token="fixture.jwt.token")=>handler(new Request("https://cmcarebase.com/api/platform-admin/billing/command",{
  method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify(operation)}));
 return {state,calls,providerCalls,request};
}
test("Checkout preview resolves native catalog and no provider side effect",async()=>{
 const f=fixture(),response=await f.request();assert.equal(response.status,200);assert.equal((await response.json()).data.summary.currency,"usd");assert.equal(f.providerCalls.length,0);
});
test("Checkout apply discloses only after exact GET and persisted receipt",async()=>{
 const f=fixture(),response=await f.request(apply);assert.equal(response.status,200);const data=(await response.json()).data;
 assert.equal(data.outcome,"open");assert.equal(f.providerCalls.length,2);assert.equal(f.calls.at(-1).path,"/rest/v1/rpc/platform_admin_read_checkout_result");
});
test("Checkout check performs no creation and keeps current session authority",async()=>{
 const f=fixture(),response=await f.request({...apply,operation:"check"});assert.equal(response.status,200);
 assert.deepEqual(f.providerCalls.map(v=>v.method),["GET"]);
});

test("Organization recovery preserves original terms, binds current SMS operation and never queries current catalog or POSTs",async()=>{
 const f=fixture({recoveryExpiry:"2026-09-11T19:00:00Z"});const {aal,...actor}=f.state.actor;
 f.state.sms={...actor,method:"sms",operation:recover};
 const response=await f.request(recover,"cmh_"+"a".repeat(43));assert.equal(response.status,200);
 const data=(await response.json()).data;assert.equal(data.preview.action,recover.action);assert.equal(data.preview.reason,recover.reason);
 assert.equal(data.preview.summary.packageId,PACKAGE);assert.equal(data.result.commandId,data.preview.commandId);
 assert.equal(data.result.action,recover.action);assert.equal(data.canStartNewCheckout,false);
 assert.deepEqual(f.providerCalls.map(v=>v.method),["GET"]);
 assert.equal(f.calls.some(v=>["/rest/v1/package_billing_prices","/rest/v1/billing_subscriptions"].includes(v.path)),false);
 assert.equal(f.calls.at(-1).path,"/rest/v1/rpc/platform_admin_read_checkout_result");
});

test("Recovery cannot apply and no-reservation evidence never invents subscription eligibility",async()=>{
 for(const canStart of [true,false]) {
  const f=fixture({noReservation:true,canStart});const response=await f.request(recover);assert.equal(response.status,200);
  assert.deepEqual((await response.json()).data,{targetId:ORG,preview:null,result:null,canStartNewCheckout:canStart});assert.equal(f.providerCalls.length,0);
 }
 for(const invalid of [{...apply,action:recover.action},{...recover,parameters:preview.parameters},{...recover,operation:"preview"}]) assert.throws(()=>parseBillingCommand(invalid));
 const f=fixture({revokeAfterGet:true});assert.equal((await f.request(recover)).status,403);assert.equal(f.state.finish.p_outcome,"open");
});
test("Expired never-dispatched preview recovery remains read-only and reauthorizes receipt disclosure",async()=>{
 const result={commandId:COMMAND,action:preview.action,targetId:ORG,outcome:"failed",replayed:true,checkedAt:NOW,
  providerStatus:null,availability:"available",canStartNewCheckout:true,retryAfterSeconds:null,session:null};
 const f=fixture({result}),response=await f.request({...apply,operation:"check"});
 assert.equal(response.status,200);assert.deepEqual((await response.json()).data,result);assert.equal(f.providerCalls.length,0);
 assert.equal(f.calls.at(-1).path,"/rest/v1/rpc/platform_admin_read_checkout_result");
 const denied=fixture({result,revoked:true});assert.equal((await denied.request({...apply,operation:"check"})).status,403);
});
test("Checkout SMS ticket binds exact package or check operation",async()=>{
 for(const operation of [preview,apply,{...apply,operation:"check"}]) {
  const f=fixture();const {aal,...actor}=f.state.actor;f.state.sms={...actor,method:"sms",operation};
  assert.equal((await f.request(operation,"cmh_"+"a".repeat(43))).status,200);
 }
 const f=fixture();const {aal,...actor}=f.state.actor;f.state.sms={...actor,method:"sms",operation:apply};
 assert.equal((await f.request({...apply,operation:"check"},"cmh_"+"a".repeat(43))).status,403);assert.equal(f.providerCalls.length,0);
});
test("Revocation after provider success preserves receipt but withholds URL",async()=>{
 const f=fixture({revokeAfterGet:true}),response=await f.request(apply);assert.equal(response.status,403);assert.equal(f.state.finish.p_outcome,"open");
 assert.equal((await response.text()).includes("checkout.stripe.com"),false);
});
test("Wrong provider customer is indeterminate with no disclosed capability",async()=>{
 const f=fixture({providerOverride:{customer:"cus_other"}}),response=await f.request(apply);assert.equal(response.status,200);
 const data=(await response.json()).data;assert.equal(data.outcome,"pending");assert.equal(data.session,null);assert.equal(data.canStartNewCheckout,false);
});
test("Checkout action and flags stay closed while legacy portal apply stays compatible",async()=>{
 assert.deepEqual(parseBillingCommand({operation:"apply",commandId:COMMAND,expectedDigest:DIGEST}),{operation:"apply",commandId:COMMAND,expectedDigest:DIGEST});
 for(const invalid of [{...preview,parameters:{...preview.parameters,quantity:10}},{...apply,action:"billing.checkout.cancel"},
  {...preview,parameters:{...preview.parameters,providerPriceId:"price_browser"}},{...apply,operation:"check",targetId:ORG}]) assert.throws(()=>parseBillingCommand(invalid));
 const f=fixture({env:{CAREMETRIC_ADMIN_CHECKOUT_COMMANDS_ENABLED:"false"}});assert.equal((await f.request()).status,503);assert.equal(f.providerCalls.length,0);
});
test("Catalog preserves high money strings and rejects numeric money or excess fields",()=>{
 const row={id:COMMAND,packageId:PACKAGE,name:"Fixture",description:"",status:"active",availability:"mapped",providerPriceId:"price_fixture",billingInterval:"month",intervalCount:1,
  billingMetric:"flat",pricingModel:"flat",currency:"usd",baseAmountMinor:"9223372036854775807",unitAmountMinor:null,includedQuantity:0,minimumQuantity:1,maximumQuantity:null,trialDays:0};
 const page={source:"application_database",providerAvailability:"not_checked",items:[row],total:1,limit:25,offset:0};
 assert.equal(projectBillingCatalog(page,{limit:25,offset:0}).items[0].baseAmountMinor,row.baseAmountMinor);
 assert.throws(()=>projectBillingCatalog({...page,items:[{...row,baseAmountMinor:100}]},{limit:25,offset:0}));
 assert.throws(()=>projectBillingCatalog({...page,items:[{...row,secretKey:"not-allowed"}]},{limit:25,offset:0}));
});
