#!/usr/bin/env bash
# Build and publish to S3/CloudFront. Usage: ./deploy.sh <stack-name>
set -euo pipefail
STACK="${1:-brickforge}"
cd "$(dirname "$0")"
# --no-fail-on-empty-changeset: a redeploy with an unchanged template must still upload the new site
aws cloudformation deploy --stack-name "$STACK" --template-file infra/template.yaml --no-fail-on-empty-changeset
out() { aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
BUCKET=$(out BucketName)
DIST=$(out DistributionId)
npm ci && npm run build
# hashed assets first (long cache), then index.html, so a visitor never gets an index that points at missing files
aws s3 sync dist "s3://$BUCKET" --exclude index.html --cache-control "public,max-age=31536000,immutable"
aws s3 cp dist/index.html "s3://$BUCKET/index.html" --cache-control "no-cache"
aws cloudfront create-invalidation --distribution-id "$DIST" --paths '/index.html' >/dev/null
out Url
