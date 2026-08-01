// RFC 9728 §3.1 — a client that knows the resource URL (https://<origin>/api/mcp)
// derives its metadata URL by inserting the well-known segment between host and
// path: /.well-known/oauth-protected-resource/api/mcp. Spec-conformant clients
// request THIS path; clients that follow the WWW-Authenticate hint from
// /api/mcp use the un-suffixed twin. Same document either way.
export const dynamic = "force-dynamic";
// Nothing to migrate for Next 15's async request APIs: this path has no dynamic
// segment, and the re-exported handler takes only the request.
export { GET } from "../../route";
