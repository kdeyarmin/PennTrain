import {AdminError, UUID} from "./platform-admin-auth.mjs";
const keys = (v,n) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === n.length && n.every(k => Object.hasOwn(v,k));
const money = v => typeof v === "string" && /^(0|[1-9][0-9]{0,18})$/.test(v) && BigInt(v) <= 9223372036854775807n;
const quantity = v => Number.isSafeInteger(v) && v >= 0;
export function projectBillingCatalog(data, operation) {
  if (!keys(data,["source","providerAvailability","items","total","limit","offset"]) || data.source !== "application_database"
    || data.providerAvailability !== "not_checked" || data.limit !== operation.limit || data.offset !== operation.offset
    || !quantity(data.total) || !Array.isArray(data.items) || data.items.length > operation.limit) throw new AdminError(502,"upstream");
  for(const row of data.items) {
    if(!keys(row,["id","packageId","name","description","status","availability","providerPriceId","billingInterval","intervalCount","billingMetric","pricingModel",
      "currency","baseAmountMinor","unitAmountMinor","includedQuantity","minimumQuantity","maximumQuantity","trialDays"])
      || !UUID.test(row.id) || !UUID.test(row.packageId) || typeof row.name !== "string" || row.name.length > 500
      || typeof row.description !== "string" || row.description.length > 4000 || row.status !== "active"
      || !["mapped","unmapped"].includes(row.availability) || (row.availability === "unmapped" ? row.providerPriceId !== null : !/^price_[A-Za-z0-9]+$/.test(row.providerPriceId))
      || !["month","year"].includes(row.billingInterval) || !Number.isInteger(row.intervalCount) || row.intervalCount < 1 || row.intervalCount > 36
      || !["flat","active_learner","active_user","active_resident","facility"].includes(row.billingMetric)
      || !["flat","per_unit","graduated","volume","flat_plus_overage","custom"].includes(row.pricingModel)
      || !/^[a-z]{3}$/.test(row.currency) || !money(row.baseAmountMinor) || !(row.unitAmountMinor === null || money(row.unitAmountMinor))
      || !quantity(row.includedQuantity) || !quantity(row.minimumQuantity) || row.minimumQuantity < 1
      || !(row.maximumQuantity === null || quantity(row.maximumQuantity) && row.maximumQuantity >= row.minimumQuantity)
      || !Number.isInteger(row.trialDays) || row.trialDays < 0 || row.trialDays > 90) throw new AdminError(502,"upstream");
  }
  return data;
}
export async function readBillingCatalog(native,operation) {
  const result=await native.rpc("platform_admin_checkout_catalog",{p_search:operation.search,p_limit:operation.limit,p_offset:operation.offset});
  if(result.error) throw new AdminError(503,"upstream");
  return projectBillingCatalog(result.data,operation);
}
