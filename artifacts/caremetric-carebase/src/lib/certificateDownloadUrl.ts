/**
 * Edge runtimes can reach Storage through an internal gateway (e.g. kong:8000) that browsers
 * cannot resolve. Storage signatures authorize the object path, not that gateway's hostname.
 * Deliver through this application's configured project API, preserving the signed path/query.
 */
export function certificateDownloadUrl(signedUrl: string, publicApiUrl: string): string {
  const signed = new URL(signedUrl);
  const publicApi = new URL(publicApiUrl);
  const route = "/storage/v1/object/sign/";
  const start = signed.pathname.indexOf(route);
  if (![signed, publicApi].every(url => ["https:", "http:"].includes(url.protocol) && !url.username && !url.password)
    || start < 0 || !signed.searchParams.get("token")) {
    throw new Error("The certificate download link is invalid. Please prepare the PDF again.");
  }
  publicApi.pathname = publicApi.pathname.replace(/\/+$/, "") + signed.pathname.slice(start);
  publicApi.search = signed.search;
  publicApi.hash = "";
  return publicApi.href;
}
