/**
 * Marketing content shared across the public marketing pages.
 *
 * The pre-redesign icon-grid content (SETTINGS, FEATURE_CATEGORIES, STEPS, OLD_WAY/NEW_WAY,
 * SECURITY_FEATURES, DEMO_MAILTO) was deleted once the redesigned pages stopped importing it --
 * each page now owns its copy, and keeping a second, unrendered source of truth here only
 * invited drift. FAQS is the one shared module left.
 */

// FAQS lives in its own dependency-free module so server/prerender-heads.mjs
// can bundle it for Node at build time; re-exported here so existing importers
// keep working unchanged.
export { FAQS } from "./faqContent";
