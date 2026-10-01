# ECS workload egress

The web task security group (`infra/aws/modules/env/compute.tf`) allows **TCP 443 only**. It used to allow all protocols to anywhere (audit P2-2). Postgres 5432 and Redis 6379 open **inside the VPC** only, and only when `enable_aws_data_plane` is on. DNS to the VPC resolver is not subject to security groups.

Security groups cannot filter by domain. The next step is AWS Network Firewall (or an egress proxy) with a domain allowlist. That step is **not built**, and this list is what it must admit:

| Destination | Why |
|---|---|
| `*.supabase.co` | database (PostgREST) |
| `*.upstash.io` | KV (REST) |
| `api.stripe.com` | payments |
| `api.resend.com` | email |
| `withpersona.com`, `api.sumsub.com` | KYC |
| `li.quest` | LI.FI swap quotes |
| RPC providers (per `ARBITRUM_RPC_URL`, `SOLANA_RPC_URL`, …) | chain reads/broadcast |
| `playintegrity.googleapis.com`, `oauth2.googleapis.com`, `fcm.googleapis.com` | attestation, push |
| `data.alpaca.markets`, market-data hosts | quotes, corporate actions |
| AWS APIs | via VPC interface endpoints (KMS, Secrets Manager, ECR, Logs) |

Verification (T-A4): run from a task, `curl -m5 telnet://example.org:22` must fail, and `curl -m5 https://example.org` must succeed (443 is open). The domain-level check applies only after the firewall exists. **Not run**: there is no AWS account access.
