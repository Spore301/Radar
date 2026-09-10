#!/bin/bash
# Allow a Google account that is NOT on ALLOWED_GOOGLE_DOMAIN to sign in.
# Usage:  ~/radar/deploy/invite.sh someone@example.com
set -euo pipefail
cd "$(dirname "$0")/.."
email="${1:?usage: invite.sh <email>}"
docker compose exec -T -e INVITE_EMAIL="$email" app node -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  const email = process.env.INVITE_EMAIL.trim().toLowerCase();
  p.invite.upsert({ where: { email }, create: { email, invitedBy: 'deploy/invite.sh' }, update: {} })
    .then(() => console.log('[radar] invited', email))
    .finally(() => p.\$disconnect());
"
