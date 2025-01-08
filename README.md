# aws-cdk-vpc-efs

## Architecture
<img width="844" alt="image" src="https://github.com/user-attachments/assets/fa8884d2-a1b6-47a3-a1e3-b6d335ef9433" />


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
