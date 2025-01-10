# aws-cdk-vpc-efs

## Architecture
<img width="837" alt="image" src="https://github.com/user-attachments/assets/edc5eb88-1efa-4a11-ad4f-61ddb52ac9c6" />


## Getting started
### Prerequisites: 
### How to deploy
- Obtain aws credential for the aws account (check ~/.aws/credential or ~/.aws/cli/cache)
- export your environment variable if you do not want to use the default one. This variable is used in bin/index.ts
```
const envName = process.env.ENVIRONMENT_NAME || 'kate'
const accountName = process.env.ACCOUNT_NAME || 'sandpit1'
const region = process.env.REGION || 'ap-southeast-2'
```
