#!/bin/bash
set -euo pipefail

S3_BUCKET=${S3_BUCKET}
ENVIRONMENT_NAME=${ENVIRONMENT_NAME}

echo "$(date) S3_BUCKET: ${S3_BUCKET} ..."
echo "$(date) ENVIRONMENT_NAME: ${ENVIRONMENT_NAME} ..."

echo "hello" >> test.txt
aws s3 cp test.txt s3://${S3_BUCKET}/test
echo "$(date) Done."