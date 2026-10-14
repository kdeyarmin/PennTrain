// One answer for every HeyGen caller when the vendor key is absent. 503, not 500:
// the function is up and the deployment is missing a secret.
export const HEYGEN_UNAVAILABLE_STATUS = 503;

export function heygenUnavailableBody(): { error: "heygen_not_configured"; message: string } {
  return {
    error: "heygen_not_configured",
    message: "Video generation is not configured.",
  };
}
