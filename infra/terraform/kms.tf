# =============================================================================
# Iron Gate — AWS KMS Key Configuration
# =============================================================================
# Creates the master encryption key used for envelope encryption of
# sensitive entity metadata stored in the events table.
#
# Encryption flow:
#   1. For each event, generate a random 256-bit Data Encryption Key (DEK).
#   2. Encrypt entity metadata with the DEK (AES-256-GCM).
#   3. Encrypt the DEK with this KMS key (envelope encryption).
#   4. Store encrypted metadata + encrypted DEK + IV in the events table.
#   5. On read, decrypt DEK via KMS, then decrypt metadata with the DEK.
#
# Key rotation is handled automatically by AWS KMS (annual rotation enabled).
# =============================================================================

# ---------------------------------------------------------------------------
# Variables
# ---------------------------------------------------------------------------

variable "kms_deletion_window_days" {
  description = "Number of days before KMS key deletion (7-30)"
  type        = number
  default     = 30
}

variable "kms_admin_arns" {
  description = "IAM ARNs allowed to administer (but not use) the KMS key"
  type        = list(string)
  default     = []
}

# ---------------------------------------------------------------------------
# KMS Key — Iron Gate Master Encryption Key
# ---------------------------------------------------------------------------

resource "aws_kms_key" "irongate_master" {
  description             = "Iron Gate master encryption key for envelope encryption of entity metadata"
  deletion_window_in_days = var.kms_deletion_window_days
  enable_key_rotation     = true
  is_enabled              = true
  key_usage               = "ENCRYPT_DECRYPT"
  customer_master_key_spec = "SYMMETRIC_DEFAULT"

  # Multi-region is intentionally disabled — data residency within single region
  multi_region = false

  policy = jsonencode({
    Version = "2012-10-17"
    Id      = "irongate-kms-policy"
    Statement = [
      # -----------------------------------------------------------------------
      # Allow account root full control (required for key management)
      # -----------------------------------------------------------------------
      {
        Sid    = "EnableRootAccountAccess"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
        }
        Action   = "kms:*"
        Resource = "*"
      },

      # -----------------------------------------------------------------------
      # Key administrators — can manage but NOT use the key for crypto ops
      # -----------------------------------------------------------------------
      {
        Sid    = "AllowKeyAdministration"
        Effect = "Allow"
        Principal = {
          AWS = length(var.kms_admin_arns) > 0 ? var.kms_admin_arns : [
            "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
          ]
        }
        Action = [
          "kms:Create*",
          "kms:Describe*",
          "kms:Enable*",
          "kms:List*",
          "kms:Put*",
          "kms:Update*",
          "kms:Revoke*",
          "kms:Disable*",
          "kms:Get*",
          "kms:Delete*",
          "kms:TagResource",
          "kms:UntagResource",
          "kms:ScheduleKeyDeletion",
          "kms:CancelKeyDeletion",
        ]
        Resource = "*"
      },

      # -----------------------------------------------------------------------
      # API service role — can ONLY encrypt and decrypt, nothing else
      # -----------------------------------------------------------------------
      {
        Sid    = "AllowAPIServiceUsage"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/irongate-api-${var.environment}"
        }
        Action = [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:GenerateDataKey",
          "kms:GenerateDataKeyWithoutPlaintext",
          "kms:DescribeKey",
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "kms:EncryptionContext:service" = "irongate"
            "kms:EncryptionContext:env"     = var.environment
          }
        }
      },

      # -----------------------------------------------------------------------
      # Deny deletion without MFA (safety net)
      # -----------------------------------------------------------------------
      {
        Sid    = "DenyDeletionWithoutMFA"
        Effect = "Deny"
        Principal = {
          AWS = "*"
        }
        Action = [
          "kms:ScheduleKeyDeletion",
          "kms:DisableKey",
        ]
        Resource = "*"
        Condition = {
          BoolIfExists = {
            "aws:MultiFactorAuthPresent" = "false"
          }
        }
      },
    ]
  })

  tags = {
    Name        = "irongate-master-key-${var.environment}"
    Environment = var.environment
    Service     = "irongate"
    ManagedBy   = "terraform"
    Purpose     = "envelope-encryption"
  }
}

# ---------------------------------------------------------------------------
# KMS Alias — human-readable name
# ---------------------------------------------------------------------------

resource "aws_kms_alias" "irongate_master" {
  name          = "alias/irongate-${var.environment}"
  target_key_id = aws_kms_key.irongate_master.key_id
}

# ---------------------------------------------------------------------------
# KMS Grant — allows the API ECS task role to use the key
# ---------------------------------------------------------------------------

resource "aws_kms_grant" "api_service" {
  name              = "irongate-api-grant"
  key_id            = aws_kms_key.irongate_master.key_id
  grantee_principal = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/irongate-api-${var.environment}"

  operations = [
    "Encrypt",
    "Decrypt",
    "GenerateDataKey",
    "DescribeKey",
  ]

  constraints {
    encryption_context_equals = {
      service = "irongate"
      env     = var.environment
    }
  }
}

# =============================================================================
# Outputs
# =============================================================================

output "kms_key_id" {
  description = "KMS key ID"
  value       = aws_kms_key.irongate_master.key_id
}

output "kms_key_arn" {
  description = "KMS key ARN — store this in the firms table for per-firm key mapping"
  value       = aws_kms_key.irongate_master.arn
}

output "kms_alias_arn" {
  description = "KMS alias ARN"
  value       = aws_kms_alias.irongate_master.arn
}
