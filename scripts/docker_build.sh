
ECR_REPOSITORY=${1}
REGION=${2}

echo "--- :aws-logo: Getting the ECR repository..."
existing_repo=$(aws ecr describe-repositories --repository-names "${ECR_REPOSITORY}" --region "${REGION}") || echo "No repository exists so creating one..."

if [ -z "${existing_repo}" ]; then
    aws ecr create-repository --repository-name "${ECR_REPOSITORY}" --region "${REGION}"
fi
