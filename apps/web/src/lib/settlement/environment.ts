/** The deployment a response came from — the environment badge in the header. */
export type DeploymentEnvironment = "production" | "preview" | "development";

export function deploymentEnvironment(env: Record<string, string | undefined> = process.env): DeploymentEnvironment {
  const v = env.VERCEL_ENV;
  if (v === "production" || v === "preview" || v === "development") return v;
  return env.NODE_ENV === "production" ? "production" : "development";
}
