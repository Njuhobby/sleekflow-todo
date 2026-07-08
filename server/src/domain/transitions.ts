/**
 * The transition table lives in shared/ because the web UI's action menus
 * derive from the same data (no illegal edge is ever offered). This module
 * is the server-side entry point for it.
 */
export { isLegalTransition, legalTargets, requiresUnblocked } from "@shared/transitions";
