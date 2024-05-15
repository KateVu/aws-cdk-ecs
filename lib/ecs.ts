import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as efs from 'aws-cdk-lib/aws-efs'
import * as assets from 'aws-cdk-lib/aws-s3-assets'
import * as core from 'aws-cdk-lib/core'
import * as ecs from 'aws-cdk-lib/aws-ecs'


import * as path from 'path'

interface EcsStackPros extends StackProps {
    region: string,
    accountId: string,
    accountName: string,
    envName: string,
}

export class EcsStack extends Stack {
    constructor(scope: Construct, id: string, props: EcsStackPros) {
        const { region, accountId, accountName } = props
        const updatedProps = {
            env: {
                region: region,
                account: accountId,
            },
            ...props
        }
        super(scope, id, updatedProps)

        const bucketName = 'output-katetest'
        const vpc = ec2.Vpc.fromLookup(this, 'vpc', {
            vpcName: `vpc-${accountName}`
        })


        // const efsFileSystem = new efs.FileSystem(this, 'efsFileSystem', {
        //     vpc: vpc,
        //     encrypted: true, // file system is not encrypted by default
        //     performanceMode: efs.PerformanceMode.GENERAL_PURPOSE, // default
        //     vpcSubnets: {
        //         subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
        //     },
        //     securityGroup: sgEFS,
        // })
        // efsFileSystem.applyRemovalPolicy( core.RemovalPolicy.DESTROY )

        // const Ec2Instance = new ec2.Instance(this, 'simple ec2', {
        //     vpc: vpc,
        //     role: role,
        //     securityGroup: sgEc2,
        //     vpcSubnets: {
        //         subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
        //     },

        //     instanceName: 'test instance',
        //     instanceType: ec2.InstanceType.of( // t2.micro has free tier usage in aws
        //         ec2.InstanceClass.T2,
        //         ec2.InstanceSize.MICRO
        //     ),
        //     machineImage: ec2.MachineImage.latestAmazonLinux2({
        //     }),
        // })

    //Task Execution Role
    const executionRole = new iam.Role(this, 'executionRole', {
        assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
        ],
      })    

    /**
     * Permission for ecs task
     */
    const taskRole = new iam.Role(this, 'taskRole', {
        assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')
        ]
    })      

    //Bucket policy to allow read+write
    taskRole.addToPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          's3:Get*',
          's3:ListBucket*',
          's3:PutObject*'
        ],
        resources: [
          'bucketArn',
          `bucketArn/*`
        ]
    }))    
}
}