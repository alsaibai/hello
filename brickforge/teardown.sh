#!/usr/bin/env bash
# Delete the stack. The bucket must be emptied first or CloudFormation reports DELETE_FAILED.
# Usage: ./teardown.sh <stack-name>
set -euo pipefail
STACK="${1:-brickforge}"
BUCKET=$(aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" --output text)
aws s3 rm "s3://$BUCKET" --recursive
aws cloudformation delete-stack --stack-name "$STACK"
aws cloudformation wait stack-delete-complete --stack-name "$STACK"
echo "deleted $STACK"
