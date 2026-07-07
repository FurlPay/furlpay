// ---------------------------------------------------------------------------
// linkedinApi.ts — LinkedIn Official REST API integration.
//
// Uses the Community Management API to post content to FurlPay's Company Page
// and pull basic analytics. Requires a valid OAuth2 access token with the
// `w_organization_social` scope.
//
// Setup:
//   1. Register an app at https://developer.linkedin.com
//   2. Apply for Marketing Developer Platform access
//   3. Get an OAuth2 access token with `w_organization_social` scope
//   4. Set LINKEDIN_ACCESS_TOKEN and LINKEDIN_ORG_ID in your .env
//
// Official Docs:
//   Posts API: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
//   Community Mgmt: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview
// ---------------------------------------------------------------------------

import fs from "fs";
import path from "path";
import { ROOT } from "./config.js";
import { banner } from "./utils.js";

// ---------------------------------------------------------------------------
// Config — read from .env file or environment variables
// ---------------------------------------------------------------------------

const ENV_PATH = path.join(ROOT, ".env");

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  if (fs.existsSync(ENV_PATH)) {
    const lines = fs.readFileSync(ENV_PATH, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [key, ...rest] = trimmed.split("=");
      env[key.trim()] = rest.join("=").trim().replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

const env = loadEnv();
const ACCESS_TOKEN = process.env.LINKEDIN_ACCESS_TOKEN ?? env.LINKEDIN_ACCESS_TOKEN ?? "";
const ORG_ID = process.env.LINKEDIN_ORG_ID ?? env.LINKEDIN_ORG_ID ?? "";
const API_VERSION = "202607"; // LinkedIn API version (YYYYMM format)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LinkedInPost {
  /** The text content of the post. */
  commentary: string;
  /** Post visibility. */
  visibility: "PUBLIC" | "CONNECTIONS" | "LOGGED_IN";
  /** Optional: URL to attach as a link preview article. */
  articleUrl?: string;
  /** Optional: Title for the article attachment. */
  articleTitle?: string;
  /** Optional: Description for the article attachment. */
  articleDescription?: string;
}

interface PostResponse {
  id: string;
  success: boolean;
  error?: string;
}

/** Who the post is published as. Organization posting needs the
 *  Community Management API product (w_organization_social scope);
 *  member posting only needs w_member_social, which this app has. */
export type PostAuthor = "member" | "organization";

interface FollowerStats {
  totalFollowers: number;
  organicFollowers: number;
  paidFollowers: number;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const BASE_URL = "https://api.linkedin.com/rest";

async function linkedinFetch(
  endpoint: string,
  method: "GET" | "POST" | "DELETE" = "GET",
  body?: Record<string, unknown>
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${ACCESS_TOKEN}`,
    "LinkedIn-Version": API_VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
    "Content-Type": "application/json",
  };

  return fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

// ---------------------------------------------------------------------------
// Public API functions
// ---------------------------------------------------------------------------

let memberUrnCache: string | null = null;

/** Resolve the authenticated member's person URN via OpenID userinfo. */
export async function getMemberUrn(): Promise<string | null> {
  if (memberUrnCache) return memberUrnCache;
  const res = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { sub?: string; name?: string };
  if (!data.sub) return null;
  memberUrnCache = `urn:li:person:${data.sub}`;
  return memberUrnCache;
}

/**
 * Create a text post on the FurlPay Company Page.
 *
 * Docs: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
 *
 * Example:
 *   await createPost({
 *     commentary: "The most active payment customer in 2026 isn't a human...",
 *     visibility: "PUBLIC",
 *     articleUrl: "https://furlpay.com/blog/five-ways-to-rob-an-ai-agent",
 *     articleTitle: "Five Ways to Rob an AI Agent",
 *   });
 */
export async function createPost(post: LinkedInPost, as: PostAuthor = "member"): Promise<PostResponse> {
  if (!ACCESS_TOKEN) {
    return { id: "", success: false, error: "Missing LINKEDIN_ACCESS_TOKEN in .env" };
  }

  let author: string;
  if (as === "organization") {
    if (!ORG_ID) return { id: "", success: false, error: "Missing LINKEDIN_ORG_ID in .env" };
    author = `urn:li:organization:${ORG_ID}`;
  } else {
    const urn = await getMemberUrn();
    if (!urn) return { id: "", success: false, error: "Couldn't resolve member URN — is the token valid?" };
    author = urn;
  }

  const payload: Record<string, unknown> = {
    author,
    commentary: post.commentary,
    visibility: post.visibility,
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };

  // Attach article/link if provided
  if (post.articleUrl) {
    payload.content = {
      article: {
        source: post.articleUrl,
        title: post.articleTitle ?? "",
        description: post.articleDescription ?? "",
      },
    };
  }

  try {
    const res = await linkedinFetch("/posts", "POST", payload);

    if (res.ok || res.status === 201) {
      const postId = res.headers.get("x-restli-id") ?? "unknown";
      return { id: postId, success: true };
    }

    const errBody = await res.text();
    return {
      id: "",
      success: false,
      error: `HTTP ${res.status}: ${errBody}`,
    };
  } catch (err) {
    return {
      id: "",
      success: false,
      error: `Network error: ${(err as Error).message}`,
    };
  }
}

/**
 * Get basic follower statistics for the Company Page.
 *
 * Docs: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-statistics
 */
export async function getFollowerStats(): Promise<FollowerStats | null> {
  if (!ACCESS_TOKEN || !ORG_ID) {
    console.error("Missing LINKEDIN_ACCESS_TOKEN or LINKEDIN_ORG_ID");
    return null;
  }

  try {
    const res = await linkedinFetch(
      `/organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=urn:li:organization:${ORG_ID}`
    );

    if (!res.ok) {
      console.error(`Failed to fetch follower stats: HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    const elements = (data as { elements: Array<Record<string, unknown>> }).elements;
    if (!elements?.length) return null;

    const stats = elements[0] as Record<string, Record<string, number>>;
    return {
      totalFollowers: (stats.followerCounts?.organicFollowerCount ?? 0) + (stats.followerCounts?.paidFollowerCount ?? 0),
      organicFollowers: stats.followerCounts?.organicFollowerCount ?? 0,
      paidFollowers: stats.followerCounts?.paidFollowerCount ?? 0,
    };
  } catch (err) {
    console.error("Error fetching follower stats:", err);
    return null;
  }
}

/**
 * Delete a post by its URN ID.
 */
export async function deletePost(postUrn: string): Promise<boolean> {
  if (!ACCESS_TOKEN) return false;
  const res = await linkedinFetch(`/posts/${encodeURIComponent(postUrn)}`, "DELETE");
  return res.ok;
}

// ---------------------------------------------------------------------------
// CLI entry point — run directly to test the API connection
// ---------------------------------------------------------------------------

async function main() {
  banner("LinkedIn API Connection Test");

  if (!ACCESS_TOKEN) {
    console.log("❌ No LINKEDIN_ACCESS_TOKEN found.\n");
    console.log("To set up LinkedIn API access:");
    console.log("  1. Go to https://developer.linkedin.com");
    console.log("  2. Create an app and apply for Community Management API");
    console.log("  3. Generate an OAuth2 access token");
    console.log(`  4. Create a .env file at: ${ENV_PATH}`);
    console.log("     with these contents:\n");
    console.log('     LINKEDIN_ACCESS_TOKEN="your_token_here"');
    console.log('     LINKEDIN_ORG_ID="your_company_page_id"');
    console.log("");
    return;
  }

  console.log("🔑 Access token found.");
  console.log(`🏢 Organization ID: ${ORG_ID}\n`);

  // Member identity — works with the openid/profile scopes this app has.
  console.log("👤 Verifying member identity (openid/profile scopes)…");
  const urn = await getMemberUrn();
  if (urn) {
    console.log(`   ✅ Authenticated as ${urn}`);
    console.log("   ✅ Personal posting available (w_member_social): npm run post -- --draft 0");
  } else {
    console.log("   ❌ Token invalid or expired — re-run: npm run get-token");
    return;
  }

  // Org endpoints — need the Community Management API product, which this
  // app doesn't have yet. Expected to fail until LinkedIn approves it.
  console.log("\n📊 Fetching Company Page follower stats (needs r_organization_social)…");
  const stats = await getFollowerStats();
  if (stats) {
    console.log(`   Total followers:   ${stats.totalFollowers}`);
    console.log(`   Organic followers: ${stats.organicFollowers}`);
    console.log(`   Paid followers:    ${stats.paidFollowers}`);
  } else {
    console.log("   ⚠️ Org access not granted yet. To unlock Company Page posting/stats:");
    console.log("      developer.linkedin.com → your app → Products → request 'Community");
    console.log("      Management API', then re-run get-token to pick up the org scopes.");
  }

  console.log("\n✅ API connection test complete.");
}

// Run if executed directly
const isMain = process.argv[1]?.includes("linkedinApi");
if (isMain) main().catch(console.error);
