# =============================================================================
# Iron Gate — VPC & Network Security Configuration
# =============================================================================
# Creates a production VPC with public/private subnet tiers, NAT gateway,
# and security groups that enforce least-privilege network access.
#
# Architecture:
#   Public subnets  -> ALB (API + Dashboard)
#   Private subnets -> API, Detection, PostgreSQL, Redis
# =============================================================================

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# ---------------------------------------------------------------------------
# Variables
# ---------------------------------------------------------------------------

variable "aws_region" {
  description = "AWS region for the Iron Gate deployment"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment (production, staging)"
  type        = string
  default     = "production"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "List of AZs for multi-AZ deployment"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b", "us-east-1c"]
}

# ---------------------------------------------------------------------------
# Data sources
# ---------------------------------------------------------------------------

data "aws_caller_identity" "current" {}

# ---------------------------------------------------------------------------
# VPC
# ---------------------------------------------------------------------------

resource "aws_vpc" "irongate" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name        = "irongate-${var.environment}"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# ---------------------------------------------------------------------------
# Internet Gateway (for public subnets)
# ---------------------------------------------------------------------------

resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.irongate.id

  tags = {
    Name        = "irongate-igw-${var.environment}"
    Environment = var.environment
  }
}

# ---------------------------------------------------------------------------
# Public Subnets (ALB tier)
# ---------------------------------------------------------------------------

resource "aws_subnet" "public" {
  count                   = length(var.availability_zones)
  vpc_id                  = aws_vpc.irongate.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index)
  availability_zone       = var.availability_zones[count.index]
  map_public_ip_on_launch = false # ALB gets an EIP, instances do not

  tags = {
    Name        = "irongate-public-${var.availability_zones[count.index]}"
    Environment = var.environment
    Tier        = "public"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.irongate.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }

  tags = {
    Name        = "irongate-public-rt-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_route_table_association" "public" {
  count          = length(var.availability_zones)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# ---------------------------------------------------------------------------
# NAT Gateway (for private subnet outbound access)
# ---------------------------------------------------------------------------

resource "aws_eip" "nat" {
  domain = "vpc"

  tags = {
    Name        = "irongate-nat-eip-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_nat_gateway" "nat" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id

  tags = {
    Name        = "irongate-nat-${var.environment}"
    Environment = var.environment
  }

  depends_on = [aws_internet_gateway.igw]
}

# ---------------------------------------------------------------------------
# Private Subnets (Application tier — API, Detection)
# ---------------------------------------------------------------------------

resource "aws_subnet" "private_app" {
  count             = length(var.availability_zones)
  vpc_id            = aws_vpc.irongate.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 10)
  availability_zone = var.availability_zones[count.index]

  tags = {
    Name        = "irongate-private-app-${var.availability_zones[count.index]}"
    Environment = var.environment
    Tier        = "private-app"
  }
}

# ---------------------------------------------------------------------------
# Private Subnets (Data tier — PostgreSQL, Redis)
# ---------------------------------------------------------------------------

resource "aws_subnet" "private_data" {
  count             = length(var.availability_zones)
  vpc_id            = aws_vpc.irongate.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 20)
  availability_zone = var.availability_zones[count.index]

  tags = {
    Name        = "irongate-private-data-${var.availability_zones[count.index]}"
    Environment = var.environment
    Tier        = "private-data"
  }
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.irongate.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.nat.id
  }

  tags = {
    Name        = "irongate-private-rt-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_route_table_association" "private_app" {
  count          = length(var.availability_zones)
  subnet_id      = aws_subnet.private_app[count.index].id
  route_table_id = aws_route_table.private.id
}

resource "aws_route_table_association" "private_data" {
  count          = length(var.availability_zones)
  subnet_id      = aws_subnet.private_data[count.index].id
  route_table_id = aws_route_table.private.id
}

# =============================================================================
# Security Groups
# =============================================================================

# ---------------------------------------------------------------------------
# ALB Security Group (public-facing)
# ---------------------------------------------------------------------------

resource "aws_security_group" "alb" {
  name_prefix = "irongate-alb-"
  description = "Iron Gate ALB - accepts HTTPS from the internet"
  vpc_id      = aws_vpc.irongate.id

  ingress {
    description = "HTTPS from anywhere"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # HTTP redirect to HTTPS
  ingress {
    description = "HTTP redirect"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "Allow all outbound to VPC"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = [var.vpc_cidr]
  }

  tags = {
    Name        = "irongate-alb-sg-${var.environment}"
    Environment = var.environment
  }

  lifecycle {
    create_before_destroy = true
  }
}

# ---------------------------------------------------------------------------
# API Security Group
# ---------------------------------------------------------------------------

resource "aws_security_group" "api" {
  name_prefix = "irongate-api-"
  description = "Iron Gate API - accepts traffic from ALB only"
  vpc_id      = aws_vpc.irongate.id

  # Accept traffic from ALB on API port
  ingress {
    description     = "HTTP from ALB"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  # Outbound: detection service
  egress {
    description     = "To detection service (HTTP)"
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.detection.id]
  }

  # Outbound: detection service (gRPC)
  egress {
    description     = "To detection service (gRPC)"
    from_port       = 50051
    to_port         = 50051
    protocol        = "tcp"
    security_groups = [aws_security_group.detection.id]
  }

  # Outbound: PostgreSQL
  egress {
    description     = "To PostgreSQL"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.postgres.id]
  }

  # Outbound: Redis
  egress {
    description     = "To Redis"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.redis.id]
  }

  # Outbound: HTTPS (Clerk, AWS APIs, webhooks)
  egress {
    description = "HTTPS to internet (Clerk, AWS APIs)"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "irongate-api-sg-${var.environment}"
    Environment = var.environment
  }

  lifecycle {
    create_before_destroy = true
  }
}

# ---------------------------------------------------------------------------
# Detection Service Security Group (internal only)
# ---------------------------------------------------------------------------

resource "aws_security_group" "detection" {
  name_prefix = "irongate-detection-"
  description = "Iron Gate Detection - accepts traffic from API only, no internet"
  vpc_id      = aws_vpc.irongate.id

  # Accept HTTP from API
  ingress {
    description     = "HTTP from API"
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id]
  }

  # Accept gRPC from API
  ingress {
    description     = "gRPC from API"
    from_port       = 50051
    to_port         = 50051
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id]
  }

  # No internet egress — detection service is fully isolated
  # If model downloads are needed, use a VPC endpoint to S3

  tags = {
    Name        = "irongate-detection-sg-${var.environment}"
    Environment = var.environment
  }

  lifecycle {
    create_before_destroy = true
  }
}

# ---------------------------------------------------------------------------
# PostgreSQL Security Group
# ---------------------------------------------------------------------------

resource "aws_security_group" "postgres" {
  name_prefix = "irongate-postgres-"
  description = "Iron Gate PostgreSQL - accepts connections from API only"
  vpc_id      = aws_vpc.irongate.id

  ingress {
    description     = "PostgreSQL from API"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id]
  }

  # No egress needed for RDS

  tags = {
    Name        = "irongate-postgres-sg-${var.environment}"
    Environment = var.environment
  }

  lifecycle {
    create_before_destroy = true
  }
}

# ---------------------------------------------------------------------------
# Redis Security Group
# ---------------------------------------------------------------------------

resource "aws_security_group" "redis" {
  name_prefix = "irongate-redis-"
  description = "Iron Gate Redis - accepts connections from API only"
  vpc_id      = aws_vpc.irongate.id

  ingress {
    description     = "Redis from API"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id]
  }

  # No egress needed for ElastiCache

  tags = {
    Name        = "irongate-redis-sg-${var.environment}"
    Environment = var.environment
  }

  lifecycle {
    create_before_destroy = true
  }
}

# =============================================================================
# VPC Flow Logs — all traffic logged for security auditing
# =============================================================================

resource "aws_flow_log" "vpc" {
  vpc_id          = aws_vpc.irongate.id
  traffic_type    = "ALL"
  iam_role_arn    = aws_iam_role.flow_log.arn
  log_destination = aws_cloudwatch_log_group.flow_log.arn

  tags = {
    Name        = "irongate-vpc-flow-log-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_cloudwatch_log_group" "flow_log" {
  name              = "/irongate/${var.environment}/vpc-flow-logs"
  retention_in_days = 90

  tags = {
    Environment = var.environment
  }
}

resource "aws_iam_role" "flow_log" {
  name_prefix = "irongate-flow-log-"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "vpc-flow-logs.amazonaws.com"
      }
    }]
  })

  tags = {
    Environment = var.environment
  }
}

resource "aws_iam_role_policy" "flow_log" {
  name_prefix = "irongate-flow-log-"
  role        = aws_iam_role.flow_log.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams",
      ]
      Effect   = "Allow"
      Resource = "*"
    }]
  })
}

# =============================================================================
# Outputs
# =============================================================================

output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.irongate.id
}

output "public_subnet_ids" {
  description = "Public subnet IDs (for ALB)"
  value       = aws_subnet.public[*].id
}

output "private_app_subnet_ids" {
  description = "Private application subnet IDs (for API, Detection)"
  value       = aws_subnet.private_app[*].id
}

output "private_data_subnet_ids" {
  description = "Private data subnet IDs (for PostgreSQL, Redis)"
  value       = aws_subnet.private_data[*].id
}

output "security_group_ids" {
  description = "Map of security group IDs"
  value = {
    alb       = aws_security_group.alb.id
    api       = aws_security_group.api.id
    detection = aws_security_group.detection.id
    postgres  = aws_security_group.postgres.id
    redis     = aws_security_group.redis.id
  }
}
