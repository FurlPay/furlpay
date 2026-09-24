# --- VPC ---------------------------------------------------------------------
# Three subnet tiers, because the trust levels genuinely differ:
#   public   — ALB only. Nothing else gets a route to the IGW.
#   private  — Fargate tasks. Egress via NAT; no inbound from the internet.
#   isolated — Aurora + ElastiCache. NO egress route at all, so a compromised
#              dependency inside the database subnet cannot phone home.

locals {
  name = "furlpay-${var.env}"

  common_tags = merge(
    {
      Project     = "furlpay"
      Environment = var.env
      ManagedBy   = "terraform"
    },
    var.tags,
  )

  azs = slice(data.aws_availability_zones.available.names, 0, 2)
}

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = merge(local.common_tags, { Name = "${local.name}-vpc" })
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = merge(local.common_tags, { Name = "${local.name}-igw" })
}

resource "aws_subnet" "public" {
  count = length(local.azs)

  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, count.index)
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = false # the ALB gets its address from the ELB service, not from this

  tags = merge(local.common_tags, { Name = "${local.name}-public-${local.azs[count.index]}", Tier = "public" })
}

resource "aws_subnet" "private" {
  count = length(local.azs)

  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, count.index + 4)
  availability_zone = local.azs[count.index]

  tags = merge(local.common_tags, { Name = "${local.name}-private-${local.azs[count.index]}", Tier = "private" })
}

resource "aws_subnet" "isolated" {
  count = length(local.azs)

  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, count.index + 8)
  availability_zone = local.azs[count.index]

  tags = merge(local.common_tags, { Name = "${local.name}-isolated-${local.azs[count.index]}", Tier = "isolated" })
}

# --- NAT ---------------------------------------------------------------------
# ONE NAT gateway outside prod, one per AZ in prod.
#
# A NAT gateway is ~$33/month plus data processing, and three environments with
# two AZs each is six of them — more than the compute in dev and staging
# combined. Single-NAT costs cross-AZ traffic and loses egress if that AZ fails,
# which in a non-production environment is an inconvenience, not an outage.

locals {
  nat_count = var.multi_az ? length(local.azs) : 1
}

resource "aws_eip" "nat" {
  count      = local.nat_count
  domain     = "vpc"
  depends_on = [aws_internet_gateway.main]

  tags = merge(local.common_tags, { Name = "${local.name}-nat-eip-${count.index}" })
}

resource "aws_nat_gateway" "main" {
  count = local.nat_count

  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id
  depends_on    = [aws_internet_gateway.main]

  tags = merge(local.common_tags, { Name = "${local.name}-nat-${count.index}" })
}

# --- Routing -----------------------------------------------------------------

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = merge(local.common_tags, { Name = "${local.name}-rt-public" })
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  count  = length(local.azs)
  vpc_id = aws_vpc.main.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main[min(count.index, local.nat_count - 1)].id
  }

  tags = merge(local.common_tags, { Name = "${local.name}-rt-private-${count.index}" })
}

resource "aws_route_table_association" "private" {
  count          = length(aws_subnet.private)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

# Isolated tier: a route table with NO default route. Declared explicitly rather
# than left to the VPC's main table, which a later edit could give an IGW route.
resource "aws_route_table" "isolated" {
  vpc_id = aws_vpc.main.id
  tags   = merge(local.common_tags, { Name = "${local.name}-rt-isolated" })
}

resource "aws_route_table_association" "isolated" {
  count          = length(aws_subnet.isolated)
  subnet_id      = aws_subnet.isolated[count.index].id
  route_table_id = aws_route_table.isolated.id
}

# --- VPC endpoints -----------------------------------------------------------
# Secrets Manager and ECR are on the task's startup path. Routing them through
# the NAT gateway means every task launch pays NAT data-processing charges and,
# worse, a NAT failure becomes a task-launch failure. Interface endpoints keep
# that traffic inside the VPC.

resource "aws_security_group" "vpce" {
  name        = "${local.name}-vpce"
  description = "Interface VPC endpoints"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "HTTPS from the application tier"
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [aws_security_group.service.id]
  }

  tags = merge(local.common_tags, { Name = "${local.name}-vpce" })
}

resource "aws_vpc_endpoint" "interface" {
  for_each = toset([
    "secretsmanager",
    "ecr.api",
    "ecr.dkr",
    "logs",
    "kms",
  ])

  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${var.region}.${each.value}"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.vpce.id]
  private_dns_enabled = true

  tags = merge(local.common_tags, { Name = "${local.name}-vpce-${each.value}" })
}

# S3 gateway endpoint — free, and ECR image layers live in S3, so without it
# every image pull goes out through the NAT.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = concat(aws_route_table.private[*].id, [aws_route_table.isolated.id])

  tags = merge(local.common_tags, { Name = "${local.name}-vpce-s3" })
}

# --- Flow logs ---------------------------------------------------------------

resource "aws_flow_log" "vpc" {
  vpc_id               = aws_vpc.main.id
  traffic_type         = "REJECT" # accepted traffic is the ALB logs' job; rejects are the security signal
  log_destination_type = "cloud-watch-logs"
  log_destination      = aws_cloudwatch_log_group.flow.arn
  iam_role_arn         = aws_iam_role.flow_log.arn

  tags = local.common_tags
}

resource "aws_cloudwatch_log_group" "flow" {
  name              = "/furlpay/${var.env}/vpc-flow"
  retention_in_days = var.log_retention_days
  tags              = local.common_tags
}
