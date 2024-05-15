#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { getAccountId } from '../lib/utils';
import { EcsStack } from '../lib/ecs';

//Environment variable for yaml file path and file name
const configFolder = '../config/'
const accountFileName = 'aws_account.yaml'

//Set up default value
const envName = process.env.ENVIRONMENT_NAME || 'kate'
const accountName = process.env.ACCOUNT_NAME || 'sandpit1'
const region = process.env.REGION || 'ap-southeast-2'

//Get aws account id
const accountId = getAccountId(accountName, configFolder, accountFileName)

const app = new cdk.App();

const ecsAppStack = new EcsStack(app, 'Ec2InstanceTest', {
  stackName: `ec2-efs-${envName}`,
  region: region,
  accountId: accountId,
  accountName: accountName,
  envName: envName,
})

cdk.Tags.of(ecsAppStack).add('createdby', 'KateVu')
cdk.Tags.of(ecsAppStack).add('createdvia', 'AWS-CDK')
cdk.Tags.of(ecsAppStack).add('environment', envName)
cdk.Tags.of(ecsAppStack).add('repo', 'https://github.com/KateVu/aws-cdk-ecs')
