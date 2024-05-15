#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { getAccountId } from '../lib/utils';
import { Ec2InstanceStack } from '../lib/ec2';

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

const ec2Instance = new Ec2InstanceStack(app, 'Ec2InstanceTest', {
  stackName: `ec2-efs-${envName}`,
  region: region,
  accountId: accountId,
  accountName: accountName,
  envName: envName,
})

cdk.Tags.of(ec2Instance).add('createdby', 'KateVu')
cdk.Tags.of(ec2Instance).add('createdvia', 'AWS-CDK')
cdk.Tags.of(ec2Instance).add('environment', envName)
cdk.Tags.of(ec2Instance).add('repo', 'https://github.com/KateVu/aws-cdk-ec2-efs')
