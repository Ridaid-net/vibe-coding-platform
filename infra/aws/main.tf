# ══════════════════════════════════════════════════════════
# RODAID · AWS ECS Fargate — Terraform
# Recursos: VPC, ECS Cluster, RDS PostgreSQL, ElastiCache Redis
#           ALB, ECR, IAM, Secrets Manager
# ══════════════════════════════════════════════════════════

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
  # Estado remoto en S3 (crear bucket antes del primer apply)
  backend "s3" {
    bucket  = "rodaid-terraform-state"
    key     = "prod/terraform.tfstate"
    region  = "sa-east-1"
    encrypt = true
  }
}

provider "aws" { region = var.aws_region }

# ── Variables ─────────────────────────────────────────────

variable "aws_region"   { default = "sa-east-1" }
variable "project"      { default = "rodaid" }
variable "env"          { default = "prod" }
variable "api_image"    { description = "ECR image URI con tag" }
variable "db_password"  { sensitive = true }
variable "jwt_secret"   { sensitive = true }

locals {
  tags = { Project = var.project, Env = var.env, ManagedBy = "terraform" }
  name = "${var.project}-${var.env}"
}

# ── ECR Repository ────────────────────────────────────────

resource "aws_ecr_repository" "api" {
  name                 = "${local.name}-api"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration { scan_on_push = true }
  tags = local.tags
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Mantener últimas 10 imágenes"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 10 }
      action       = { type = "expire" }
    }]
  })
}

# ── VPC ───────────────────────────────────────────────────

resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags = merge(local.tags, { Name = "${local.name}-vpc" })
}

resource "aws_subnet" "public" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.${count.index}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true
  tags = merge(local.tags, { Name = "${local.name}-public-${count.index}" })
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.${count.index + 10}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]
  tags = merge(local.tags, { Name = "${local.name}-private-${count.index}" })
}

data "aws_availability_zones" "available" {}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = merge(local.tags, { Name = "${local.name}-igw" })
}

# ── ECS Cluster ───────────────────────────────────────────

resource "aws_ecs_cluster" "main" {
  name = "${local.name}-cluster"
  setting { name = "containerInsights", value = "enabled" }
  tags = local.tags
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]
  default_capacity_provider_strategy {
    base              = 1
    weight            = 70
    capacity_provider = "FARGATE"
  }
  default_capacity_provider_strategy {
    weight            = 30
    capacity_provider = "FARGATE_SPOT"   # 70% más barato — tolerante a interrupciones
  }
}

# ── Secrets Manager ───────────────────────────────────────

resource "aws_secretsmanager_secret" "api_secrets" {
  name = "${local.name}/api"
  tags = local.tags
}

resource "aws_secretsmanager_secret_version" "api_secrets" {
  secret_id = aws_secretsmanager_secret.api_secrets.id
  secret_string = jsonencode({
    JWT_SECRET              = var.jwt_secret
    BFA_WALLET_PRIVATE_KEY  = "COMPLETAR"
    MXM_CLIENT_SECRET       = "COMPLETAR"
    MINSEG_API_KEY          = "COMPLETAR"
  })
}

# ── RDS PostgreSQL 16 ─────────────────────────────────────

resource "aws_db_subnet_group" "main" {
  name       = "${local.name}-db-subnet"
  subnet_ids = aws_subnet.private[*].id
  tags       = local.tags
}

resource "aws_db_instance" "postgres" {
  identifier              = "${local.name}-postgres"
  engine                  = "postgres"
  engine_version          = "16.1"
  instance_class          = "db.t3.micro"   # ~$15/mes — escalar a t3.small en producción
  allocated_storage       = 20
  max_allocated_storage   = 100             # auto-scaling hasta 100 GB
  storage_encrypted       = true
  db_name                 = "rodaid_db"
  username                = "rodaid_user"
  password                = var.db_password
  db_subnet_group_name    = aws_db_subnet_group.main.name
  vpc_security_group_ids  = [aws_security_group.db.id]
  backup_retention_period = 7              # 7 días de backups automáticos
  deletion_protection     = true           # no borrar por accidente
  skip_final_snapshot     = false
  final_snapshot_identifier = "${local.name}-final-snap"
  tags = local.tags
}

# ── ElastiCache Redis 7 ───────────────────────────────────

resource "aws_elasticache_subnet_group" "main" {
  name       = "${local.name}-redis-subnet"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = "${local.name}-redis"
  description          = "RODAID Bull queues"
  node_type            = "cache.t3.micro"  # ~$15/mes
  num_cache_clusters   = 1
  engine_version       = "7.0"
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = [aws_security_group.redis.id]
  at_rest_encryption_enabled  = true
  transit_encryption_enabled  = false    # internal VPC only
  tags = local.tags
}

# ── ECS Task Definition ───────────────────────────────────

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name}-api"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 512    # 0.5 vCPU
  memory                   = 1024   # 1 GB
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "rodaid-api"
    image     = var.api_image
    essential = true

    portMappings = [{ containerPort = 3001, protocol = "tcp" }]

    environment = [
      { name = "NODE_ENV",    value = "production" },
      { name = "PORT",        value = "3001" },
      { name = "API_VERSION", value = "v1" },
      { name = "DATABASE_URL", value = "postgresql://rodaid_user:${var.db_password}@${aws_db_instance.postgres.address}:5432/rodaid_db" },
      { name = "REDIS_URL",   value = "redis://${aws_elasticache_replication_group.redis.primary_endpoint_address}:6379" },
    ]

    secrets = [
      { name = "JWT_SECRET", valueFrom = "${aws_secretsmanager_secret.api_secrets.arn}:JWT_SECRET::" },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = "/ecs/${local.name}-api"
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "api"
      }
    }

    healthCheck = {
      command     = ["CMD-SHELL", "curl -f http://localhost:3001/api/v1/health || exit 1"]
      interval    = 30
      timeout     = 10
      retries     = 3
      startPeriod = 20
    }
  }])

  tags = local.tags
}

# ── ECS Service ───────────────────────────────────────────

resource "aws_ecs_service" "api" {
  name            = "${local.name}-api-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = 1

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "rodaid-api"
    container_port   = 3001
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true    # rollback automático si el nuevo deploy falla
  }

  tags = local.tags
  depends_on = [aws_lb_listener.https]
}

# ── ALB ───────────────────────────────────────────────────

resource "aws_lb" "main" {
  name               = "${local.name}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id
  tags               = local.tags
}

resource "aws_lb_target_group" "api" {
  name        = "${local.name}-api-tg"
  port        = 3001
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    path                = "/api/v1/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
  }

  tags = local.tags
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate.api.arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

# ── ACM Certificate (api.rodaid.com.ar) ───────────────────

resource "aws_acm_certificate" "api" {
  domain_name               = "api.rodaid.com.ar"
  subject_alternative_names = ["*.rodaid.com.ar"]
  validation_method         = "DNS"
  tags                      = local.tags
  lifecycle { create_before_destroy = true }
}

# ── Security Groups ───────────────────────────────────────

resource "aws_security_group" "alb" {
  name   = "${local.name}-alb-sg"
  vpc_id = aws_vpc.main.id
  ingress { from_port=443; to_port=443; protocol="tcp"; cidr_blocks=["0.0.0.0/0"] }
  ingress { from_port=80;  to_port=80;  protocol="tcp"; cidr_blocks=["0.0.0.0/0"] }
  egress  { from_port=0;   to_port=0;   protocol="-1";  cidr_blocks=["0.0.0.0/0"] }
  tags = merge(local.tags, { Name = "${local.name}-alb-sg" })
}

resource "aws_security_group" "api" {
  name   = "${local.name}-api-sg"
  vpc_id = aws_vpc.main.id
  ingress { from_port=3001; to_port=3001; protocol="tcp"; security_groups=[aws_security_group.alb.id] }
  egress  { from_port=0;    to_port=0;    protocol="-1";  cidr_blocks=["0.0.0.0/0"] }
  tags = merge(local.tags, { Name = "${local.name}-api-sg" })
}

resource "aws_security_group" "db" {
  name   = "${local.name}-db-sg"
  vpc_id = aws_vpc.main.id
  ingress { from_port=5432; to_port=5432; protocol="tcp"; security_groups=[aws_security_group.api.id] }
  tags = merge(local.tags, { Name = "${local.name}-db-sg" })
}

resource "aws_security_group" "redis" {
  name   = "${local.name}-redis-sg"
  vpc_id = aws_vpc.main.id
  ingress { from_port=6379; to_port=6379; protocol="tcp"; security_groups=[aws_security_group.api.id] }
  tags = merge(local.tags, { Name = "${local.name}-redis-sg" })
}

# ── IAM Roles ─────────────────────────────────────────────

resource "aws_iam_role" "ecs_execution" {
  name = "${local.name}-ecs-execution"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect="Allow"; Principal={Service="ecs-tasks.amazonaws.com"}; Action="sts:AssumeRole" }]
  })
  managed_policy_arns = [
    "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
  ]
  tags = local.tags
}

resource "aws_iam_role" "ecs_task" {
  name = "${local.name}-ecs-task"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect="Allow"; Principal={Service="ecs-tasks.amazonaws.com"}; Action="sts:AssumeRole" }]
  })
  # Permisos para leer secrets desde Secrets Manager
  inline_policy {
    name = "secrets-access"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [{
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [aws_secretsmanager_secret.api_secrets.arn]
      }]
    })
  }
  tags = local.tags
}

# ── GitHub Actions OIDC (sin claves estáticas) ────────────

data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

resource "aws_iam_role" "github_actions" {
  name = "${local.name}-github-actions"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = data.aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringLike = {
          "token.actions.githubusercontent.com:sub" = "repo:tu-org/rodaid-api:*"
        }
      }
    }]
  })
  inline_policy {
    name = "ecr-ecs"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [
        { Effect="Allow"; Action=["ecr:GetAuthorizationToken"]; Resource="*" },
        { Effect="Allow"; Action=["ecr:BatchCheckLayerAvailability","ecr:GetDownloadUrlForLayer","ecr:BatchGetImage","ecr:InitiateLayerUpload","ecr:UploadLayerPart","ecr:CompleteLayerUpload","ecr:PutImage"]; Resource=aws_ecr_repository.api.arn },
        { Effect="Allow"; Action=["ecs:DescribeServices","ecs:DescribeTaskDefinition","ecs:RegisterTaskDefinition","ecs:UpdateService"]; Resource="*" },
        { Effect="Allow"; Action=["iam:PassRole"]; Resource=[aws_iam_role.ecs_execution.arn,aws_iam_role.ecs_task.arn] },
      ]
    })
  }
  tags = local.tags
}

# ── CloudWatch Logs ───────────────────────────────────────

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${local.name}-api"
  retention_in_days = 30
  tags              = local.tags
}

# ── Outputs ───────────────────────────────────────────────

output "ecr_repository_url"   { value = aws_ecr_repository.api.repository_url }
output "alb_dns"              { value = aws_lb.main.dns_name }
output "db_endpoint"          { value = aws_db_instance.postgres.address; sensitive=true }
output "redis_endpoint"       { value = aws_elasticache_replication_group.redis.primary_endpoint_address; sensitive=true }
output "github_actions_role"  { value = aws_iam_role.github_actions.arn }
output "api_url"              { value = "https://api.rodaid.com.ar" }
