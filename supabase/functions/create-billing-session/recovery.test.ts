import {assertEquals} from "jsr:@std/assert@1.0.14";
import {createCreateBillingSessionHandler} from "./handler.ts";

const ORG="11111111-1111-4111-8111-111111111111", ACTOR="22222222-2222-4222-8222-222222222222", COMMAND="33333333-3333-4333-8333-333333333333";
const RES="44444444-4444-4444-8444-444444444444", LEASE="55555555-5555-4555-8555-555555555555", GRANT="66666666-6666-4666-8666-666666666666";
const env:Record<string,string>={SUPABASE_URL:"https://native.test",SUPABASE_ANON_KEY:"anon",SUPABASE_SERVICE_ROLE_KEY:"service",STRIPE_SECRET_KEY:"sk_test_fixture"};
function fixture({unknown=false,none=false,revoked=false,forbidden=false}={}) {
 const calls:string[]=[], providerCalls:string[]=[];
 let authorizations=0;
 const values={mode:"subscription",client_reference_id:ORG,customer:"cus_fixture",metadata:{organization_id:ORG,billing_interval:"month"},line_items:[{price:"price_retired",quantity:1}]};
 const preview={commandId:COMMAND,action:"billing.checkout.recover",targetId:ORG,reason:"Native administrator requested Checkout recovery",
  expiresAt:new Date(Date.now()-600000).toISOString(),previewDigest:"a".repeat(64),summary:{kind:"checkout",organizationName:"Original",packageId:GRANT,
   billingInterval:"month",intervalCount:1,currency:"usd",billingMetric:"flat",quantity:1,providerPriceId:"price_retired",providerCustomerId:"cus_fixture",trialDays:0}};
 const result={commandId:COMMAND,action:preview.action,targetId:ORG,outcome:unknown?"pending":"expired",replayed:true,
  checkedAt:unknown?null:new Date().toISOString(),providerStatus:unknown?null:"expired",availability:unknown?"unavailable":"available",
  canStartNewCheckout:!unknown,retryAfterSeconds:unknown?30:null,session:null};
 const handler=createCreateBillingSessionHandler({getEnv:k=>env[k],createClient:(_url,key)=>({
  auth:{getUser:async()=>({data:{user:{id:ACTOR}},error:null})},
  from:(table:string)=>{assertEquals(table,"profiles");const q={select:()=>q,eq:()=>q,single:async()=>({data:{id:ACTOR,role:"org_admin",organization_id:ORG,is_active:true},error:null})};return q;},
  rpc:async(name:string,args:Record<string,unknown>)=>{
   calls.push(name);
   if(name==="identity_assurance_is_current"||name==="has_effective_permission")return {data:!forbidden,error:null};
   if(name==="authorize_native_checkout") {assertEquals(key,"anon");assertEquals(args.p_parameters,{action:"recover"});authorizations++;
    return revoked&&authorizations>1?{data:null,error:{code:"42501"}}:{data:GRANT,error:null};}
   assertEquals(key,"service");
   if(name==="recover_native_checkout")return {data:{preview:none?null:preview,canStartNewCheckout:!unknown},error:null};
   if(name==="claim_native_checkout_recovery")return {data:unknown?{kind:"result",data:result}:{kind:"check",reservationId:RES,commandId:COMMAND,targetId:ORG,leaseId:LEASE,
    idempotencyKey:`carebase:checkout:${RES}`,values,priorSession:{id:"cs_test_fixture",customerId:"cus_fixture"},replayed:true,firstDispatch:false,priceConfiguration:{currency:"usd",interval_count:1}},error:null};
   if(name==="finish_checkout_reservation"){assertEquals(args.p_outcome,"expired");return {data:null,error:null};}
   if(name==="read_native_checkout_result")return {data:result,error:null};
   throw Error(name);
  },
 }),stripePost:async()=>{providerCalls.push("POST");throw Error("Recovery must never POST");},stripeGet:async()=>{providerCalls.push("GET");return {ok:true,status:200,data:{
  id:"cs_test_fixture",mode:"subscription",client_reference_id:ORG,metadata:values.metadata,customer:"cus_fixture",subscription:null,status:"expired",livemode:false,
  expires_at:Math.floor(Date.now()/1000)-60,url:null,line_items:{has_more:false,data:[{quantity:1,price:{id:"price_retired",active:false,type:"recurring",livemode:false,currency:"usd",recurring:{interval:"month",interval_count:1}}}]},
 }}}});
 const request=(extra={})=>handler(new Request("https://native.test/create-billing-session",{method:"POST",headers:{authorization:"Bearer real-native-session","content-type":"application/json"},
  body:JSON.stringify({action:"checkout_recover",organizationId:ORG,idempotencyKey:"native-recovery",...extra})}));
 return {request,calls,providerCalls};
}
Deno.test("Native recovery reauthorizes after GET and observes retired original terms without catalog resolution",async()=>{
 const f=fixture(),response=await f.request();assertEquals(response.status,200);const data=(await response.json()).data;
 assertEquals(data.preview.summary.providerPriceId,"price_retired");assertEquals(data.result.outcome,"expired");assertEquals(data.canStartNewCheckout,true);
 assertEquals(f.providerCalls,["GET"]);assertEquals(f.calls.filter(v=>v==="authorize_native_checkout").length,2);
});
Deno.test("Native recovery unknown/absent reservations never cause POST",async()=>{
 for(const config of [{unknown:true},{none:true}]) {const f=fixture(config),response=await f.request();assertEquals(response.status,200);assertEquals(f.providerCalls,[]);}
});
Deno.test("Native recovery preserves receipt after revocation but rejects disclosure and browser parameters",async()=>{
 const f=fixture({revoked:true});assertEquals((await f.request()).status,403);assertEquals(f.calls.includes("finish_checkout_reservation"),true);
 assertEquals((await fixture().request({packageId:GRANT})).status,400);assertEquals((await fixture({forbidden:true}).request()).status,403);
});
