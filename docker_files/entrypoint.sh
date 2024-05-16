#!/bin/bash
set -euo pipefail

S3_BUCKET=${S3_BUCKET}
ENVIRONMENT_NAME=${ENVIRONMENT_NAME}

echo "$(date) S3_BUCKET: ${S3_BUCKET} ..."
echo "$(date) ENVIRONMENT_NAME: ${ENVIRONMENT_NAME} ..."

echo "$(date) Done."