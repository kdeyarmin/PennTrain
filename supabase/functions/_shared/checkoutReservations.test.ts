import {assertEquals, assertRejects} from "jsr:@std/assert@1.0.14";
import {checkoutUrl, executeCheckoutClaim, projectCheckoutResult} from "./checkoutReservations.ts";

const ORG="11111111-1111-4111-8111-111111111111", COMMAND="22222222-2222-4222-8222-222222222222";
const RESERVATION="33333333-3333-4333-8333-333333333333", LEASE="44444444-4444-4444-8444-444444444444";
const values={mode:"subscription",client_reference_id:ORG,customer:"cus_fixture",line_items:[{price:"price_fixture",quantity:3}],
 metadata:{organization_id:ORG,package_id:"55555555-5555-4555-8555-555555555555",billing_interval:"month"}};
const claim={kind:"create",reservationId:RESERVATION,commandId:COMMAND,targetId:ORG,leaseId:LEASE,
 idempotencyKey:`carebase:checkout:${RESERVATION}`,values,priorSession:null,replayed:false,firstDispatch:true,
 priceConfiguration:{currency:"usd",interval_count:1}};
const session={id:"cs_test_fixture",object:"checkout.session",mode:"subscription",client_reference_id:ORG,customer:"cus_fixture",subscription:null,
 status:"open",metadata:values.metadata,livemode:false,expires_at:Math.floor(Date.now()/1000)+3600,
 url:"https://checkout.stripe.com/c/pay/cs_test_fixture#safe%2Ffragment",line_items:{has_more:false,data:[{price:{active:true,livemode:false,type:"recurring",id:"price_fixture",currency:"usd",recurring:{interval:"month",interval_count:1}},quantity:3}]}};
function fixture(overrides: Record<string,unknown>={}) {
 const calls:unknown[]=[],finishes:Record<string,unknown>[]=[];
 const options={secretKey:"sk_test_fixture",admin:{rpc:async(name:string,args:Record<string,unknown>)=>{
   assertEquals(name,"finish_checkout_reservation");finishes.push(args); return {error:null};}},
 stripePost:async(path:string,_key:string,params:unknown,key?:string)=>{
   calls.push({method:"POST",path,params,key});return {ok:true,status:200,data:structuredClone(session)};},
 stripeGet:async(path:string)=>{calls.push({method:"GET",path});return {ok:true,status:200,data:structuredClone(session)};},...overrides};
 return {calls,finishes,options};
}
Deno.test("Checkout POST is followed by exact fixed GET before successful receipt",async()=>{
 const f=fixture();await executeCheckoutClaim(claim,f.options);
 assertEquals(f.calls,[{method:"POST",path:"/v1/checkout/sessions",params:values,key:claim.idempotencyKey},
   {method:"GET",path:"/v1/checkout/sessions/cs_test_fixture?expand%5B%5D=line_items"}]);
 assertEquals(f.finishes[0].p_outcome,"open");
});
Deno.test("POST success with GET timeout retains known ID privately and stays indeterminate",async()=>{
 const f=fixture({stripeGet:async()=>{throw new Error("Synthetic timeout");}});await executeCheckoutClaim(claim,f.options);
 assertEquals(f.finishes[0].p_outcome,"indeterminate");
 assertEquals((f.finishes[0].p_session as Record<string,unknown>).id,session.id);
});
Deno.test("Known-ID uncertain retry never POSTs again",async()=>{
 const f=fixture();await executeCheckoutClaim({...claim,kind:"check",firstDispatch:false,priorSession:{id:session.id,customerId:"cus_fixture"}},f.options);
 assertEquals(f.calls.length,1);assertEquals((f.calls[0] as {method:string}).method,"GET");
});
Deno.test("Only first dispatch can become definitive failure; retry401 keeps uncertainty",async()=>{
 for(const firstDispatch of [true,false]) {
  const f=fixture({stripePost:async()=>({ok:false,status:401,data:{}})});
  await executeCheckoutClaim({...claim,firstDispatch},f.options);
  assertEquals(f.finishes[0].p_outcome,firstDispatch?"failed":"indeterminate");
 }
});
Deno.test("Wrong organization/customer/price/quantity/currency/cadence/mode never becomes an open capability",async()=>{
 const variants=[{client_reference_id:COMMAND},{customer:"cus_other"},{livemode:true},{mode:"payment"},
  {line_items:{has_more:false,data:[{price:{active:true,livemode:false,type:"recurring",id:"price_other",currency:"usd",recurring:{interval:"month",interval_count:1}},quantity:3}]}},
  {line_items:{has_more:false,data:[{price:{active:true,livemode:false,type:"recurring",id:"price_fixture",currency:"eur",recurring:{interval:"month",interval_count:1}},quantity:3}]}},
  {line_items:{has_more:false,data:[{price:{active:true,livemode:false,type:"recurring",id:"price_fixture",currency:"usd",recurring:{interval:"month",interval_count:3}},quantity:3}]}},
  {line_items:{has_more:false,data:[{price:{active:true,livemode:false,type:"recurring",id:"price_fixture",currency:"usd",recurring:{interval:"month",interval_count:1}},quantity:4}]}}];
 for(const priceFields of [{active:false},{livemode:true},{type:"one_time"}]) variants.push({line_items:{has_more:false,data:[{
   price:{...session.line_items.data[0].price,...priceFields},quantity:3}]}});
 for(const wrong of variants) {
  const f=fixture({stripeGet:async()=>({ok:true,status:200,data:{...structuredClone(session),...wrong}})});
  await executeCheckoutClaim(claim,f.options);assertEquals(f.finishes[0].p_outcome,"indeterminate");
 }
});
Deno.test("Completed reservation releases only for exact provider-confirmed terminal subscription",async()=>{
 for(const status of ["canceled","incomplete_expired","active","paused","unpaid","past_due",null]) {
  const f=fixture({stripeGet:async(path:string)=>path.startsWith("/v1/subscriptions/")
    ? {ok:status!==null,status:status===null?503:200,data:{id:"sub_fixture",customer:"cus_fixture",livemode:false,metadata:{organization_id:ORG},status}}
    : {ok:true,status:200,data:{...structuredClone(session),status:"complete",subscription:"sub_fixture",url:null}}});
  await executeCheckoutClaim({...claim,kind:"check",firstDispatch:false,priorSession:{id:session.id,customerId:"cus_fixture"}},f.options);
  assertEquals(f.finishes[0].p_outcome,["canceled","incomplete_expired"].includes(status??"")?"closed":"complete");
 }
});
Deno.test("Mismatched terminal subscription cannot release another organization's reservation",async()=>{
 for(const wrong of [{customer:"cus_other"},{id:"sub_other"},{livemode:true},{metadata:{organization_id:COMMAND}}]) {
  const f=fixture({stripeGet:async(path:string)=>path.startsWith("/v1/subscriptions/")
   ? {ok:true,status:200,data:{id:"sub_fixture",customer:"cus_fixture",livemode:false,metadata:{organization_id:ORG},status:"canceled",...wrong}}
   : {ok:true,status:200,data:{...structuredClone(session),status:"complete",subscription:"sub_fixture",url:null}}});
  await executeCheckoutClaim({...claim,kind:"check",firstDispatch:false,priorSession:{id:session.id,customerId:"cus_fixture"}},f.options);
  assertEquals(f.finishes[0].p_outcome,"complete");
 }
});
Deno.test("Checkout URLs are fixed to exact session and support documented fragments only",()=>{
 assertEquals(checkoutUrl(session.url,session.id),true);
 for(const url of ["https://checkout.stripe.com:443/c/pay/cs_test_fixture", "https://user@checkout.stripe.com/c/pay/cs_test_fixture",
  "https://checkout.stripe.com/c/pay/cs_test_other", "https://checkout.stripe.com/c/pay/cs_test_fixture?redirect=other",
  "https://checkout.stripe.com/c/pay/cs_test_fixture#bad%xx", "https://checkout.stripe.com/c/pay/cs_test_fixture/extra"]) assertEquals(checkoutUrl(url,session.id),false);
});
Deno.test("Receipt persistence failure is not converted to successful disclosure",async()=>{
 const f=fixture({admin:{rpc:async()=>({error:{code:"57014"}})}});
 await assertRejects(()=>executeCheckoutClaim(claim,f.options));
});
Deno.test("Pending result projection rejects capability URLs and fabricated availability",()=>{
 const result={commandId:COMMAND,action:"billing.checkout.create",targetId:ORG,outcome:"pending",replayed:true,
  checkedAt:null,providerStatus:null,availability:"unavailable",canStartNewCheckout:false,retryAfterSeconds:30,session:null};
 assertEquals(projectCheckoutResult(result),result);
 let denied=false;try {projectCheckoutResult({...result,session});} catch {denied=true;}assertEquals(denied,true);
});
Deno.test("Terminal result projection rejects contradictory provider state, invalid dates and mode",()=>{
 const result={commandId:COMMAND,action:"billing.checkout.create",targetId:ORG,outcome:"open",replayed:true,
  checkedAt:new Date().toISOString(),providerStatus:"open",availability:"available",canStartNewCheckout:false,retryAfterSeconds:null,
  session:{kind:"checkout",id:session.id,url:session.url,expiresAt:new Date(session.expires_at*1000).toISOString(),livemode:false}};
 assertEquals(projectCheckoutResult(result),result);
 for(const bad of [{...result,checkedAt:"September 11, 2026"},{...result,checkedAt:"2026-02-30T12:00:00Z"},
  {...result,outcome:"complete",session:null},{...result,session:{...result.session,livemode:true}},
  {...result,session:{...result.session,expiresAt:result.checkedAt}}]) {
   let denied=false;try {projectCheckoutResult(bad);} catch {denied=true;}assertEquals(denied,true);
 }
});
