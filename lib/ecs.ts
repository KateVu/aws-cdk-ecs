import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as ecr from 'aws-cdk-lib/aws-ecr'
import * as eventTarget from 'aws-cdk-lib/aws-events-targets'
import * as events from 'aws-cdk-lib/aws-events'
import * as sns from 'aws-cdk-lib/aws-sns'

import * as path from 'path'

interface EcsStackPros extends StackProps {
    region: string,
    accountId: string,
    accountName: string,
    envName: string,
}

export class EcsStack extends Stack {
    constructor(scope: Construct, id: string, props: EcsStackPros) {
        const { region, accountId, accountName, envName } = props
        const updatedProps = {
            env: {
                region: region,
                account: accountId,
            },
            ...props
        }
        super(scope, id, updatedProps)

        const bucketName = `aws-cdk-ecs-output-${accountName}`
        const vpc = ec2.Vpc.fromLookup(this, 'vpc', {
            vpcName: `vpc-${accountName}`
        })

    //Task Execution Role
    const ecsExecutionRole = new iam.Role(this, 'ecsExecutionRole', {
        assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
        ],
      })    

    /**
     * Permission for ecs task
     */
    const ecsTaskRole = new iam.Role(this, 'ecsTaskRole', {
        assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')
        ]
    })      

    //Bucket policy to allow read+write
    ecsTaskRole.addToPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          's3:Get*',
          's3:ListBucket*',
          's3:PutObject*'
        ],
        resources: [
          `arn:aws:s3:::${bucketName}`,
          `arn:aws:s3:::${bucketName}/*`
        ]
    }))


    //Events bridge rule role
    const eventsRole = new iam.Role(this, 'eventsRuleRole', {
      assumedBy: new iam.ServicePrincipal('events.amazonaws.com')
    })
    eventsRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2ContainerServiceEventsRole'))
   
    //Granting ECS role permission
    ecsExecutionRole.grantPassRole(eventsRole)
    ecsTaskRole.grantPassRole(eventsRole)
    const importedFileSystemID = process.env.FILE_SYSTEM_ID || ''
    if (importedFileSystemID == '') {
      throw new Error(`Cannot find EFS File system ID`)
    }

    /**
     * Task definition
     */
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'taskDefinition', {
      //4GB Ram - Between 4096 (4 GB) and 16384 (16 GB) in increments of 1024 (1 GB) - Available cpu values: 2048 (2 vCPU)
      memoryLimitMiB: 4096,
      //2 vCPU
      cpu: 2048,
      taskRole: ecsTaskRole,
      executionRole: ecsExecutionRole,
      volumes: [
        {
          name: "efs",
          efsVolumeConfiguration: {
            fileSystemId: importedFileSystemID,
            // ... other options here ...
          },
        }
      ]
    })
    
    const ecrRepoName = process.env.ECR_REPOSITORY || ''
    if (ecrRepoName == '') {
      throw new Error(`Cannot find ECR_REPOSITORY`)
    }

    // const ecrRepo = ecr.Repository.fromRepositoryName(this, 'ecrrepo', ecrRepoName)
    const ecrRepo = ecr.Repository.fromRepositoryArn(this, 'ecrrepo', `arn:aws:ecr:${region}:054671736399:repository/${ecrRepoName}`)

    const imageTags = process.env.IMAGE_TAG || 'none'

    /**
     * Containter
     */
    const container = taskDefinition.addContainer('taskDefinitionContainer', {
      image: new ecs.EcrImage(ecrRepo, imageTags),
      environment: {
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'ecs' }),
    })

    container.addMountPoints(
      {
        sourceVolume: 'efs',
        containerPath: '/mnt/data',
        readOnly: false        
      }
    )

    //Cluster
    const cluster = new ecs.Cluster(this, 'cluster', {
      vpc
    })

    //Security Group
    const sg = new ec2.SecurityGroup(this, 'EcsEgressSg', {
      vpc,
      allowAllOutbound: true,
      description: 'Allows all outbound traffic to facilitate s3Copy'
    })

    /**
     * Events Bridge spins up ECS Task
     */
    const target = new eventTarget.EcsTask({
      cluster,
      taskDefinition,
      securityGroups: [sg],
      subnetSelection: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      },
      platformVersion: ecs.FargatePlatformVersion.VERSION1_4,
      role: eventsRole,
      containerOverrides: [
        {
          containerName: container.containerName,
          environment: [
            {
              name: 'S3_BUCKET', value:  bucketName
            },
            {
              name: 'ENVIRONMENT_NAME', value:  envName
            },
          ]
        },
      ],
      propagateTags: ecs.PropagatedTagSource.TASK_DEFINITION
    })
    /**
     * Cron job trigger backup to archive bucket
     */
    new events.Rule(this, "cronJobTriggerArchive", {
      //1:00AM AEST - temporary
      schedule: events.Schedule.cron({minute: '0', hour: '15'}),
      targets: [target],
      description: 'Runs daily at specific time',
    })

    /**
     * Event bridge rule for failed AWS Batch which has SNS above as target
     * Copy rqp-rds-backups-to-s3 repo
     */
    const filterFailedECSRule = new events.Rule(this, "filterFailedEFSBackup", {
      eventPattern: {
        source: ["aws.ecs"],
        detailType: ["ECS Task State Change"],
        detail: {
          "containers": {
            "exitCode": [1, 137, 139, 255]
          },
          "lastStatus": [
            "STOPPED"
          ],
          "stoppedReason":[
            "Essential container in task exited"
          ],
          "taskDefinitionArn": [
            taskDefinition.taskDefinitionArn
          ]
        }
      },
      description: 'Filters for failed ECS tasks'
    })

    const snsTopic = sns.Topic.fromTopicArn(this, 'failedSNSTopic', `arn:aws:sns:${region}:${accountId}:aws-cdk-ecs-demo`)
    //Add SNS as target
    filterFailedECSRule.addTarget(new eventTarget.SnsTopic(snsTopic))    
}
}