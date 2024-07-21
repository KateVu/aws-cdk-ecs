import { Fn, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as ecr from 'aws-cdk-lib/aws-ecr'
import * as eventTarget from 'aws-cdk-lib/aws-events-targets'
import * as events from 'aws-cdk-lib/aws-events'
import * as sns from 'aws-cdk-lib/aws-sns'

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

    ecsExecutionRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'elasticfilesystem:DescribeMountTargets',
        'elasticfilesystem:ClientMount',
        'elasticfilesystem:ClientWrite'
      ],
      resources: ['*'],
    }))

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

    ecsTaskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'elasticfilesystem:DescribeMountTargets',
        'elasticfilesystem:ClientMount',
        'elasticfilesystem:ClientWrite'
      ],
      resources: ['*'],
    }))

    //Events bridge rule role
    const eventsRole = new iam.Role(this, 'eventsRuleRole', {
      assumedBy: new iam.ServicePrincipal('events.amazonaws.com')
    })
    eventsRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2ContainerServiceEventsRole'))

    //Granting ECS role permission
    ecsExecutionRole.grantPassRole(eventsRole)
    ecsTaskRole.grantPassRole(eventsRole)
    const main_app_stack = process.env.MAIN_APP_STACK || ''

    if (main_app_stack == '') {
      throw new Error(`Cannot get MAIN_APP_STACK from env variable, abort`)
    }

    const importedFileSystemID = Fn.importValue(`${main_app_stack}-efs-id`)

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

    const aws_shared_account_id = process.env.AWS_SHARED_ACCOUNT_ID || 'none'
    const ecrRepo = ecr.Repository.fromRepositoryArn(this, 'ecrrepo', `arn:aws:ecr:${region}:${aws_shared_account_id}:repository/${ecrRepoName}`)

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
    const sg = new ec2.SecurityGroup(this, 'EcsSg', {
      vpc,
      allowAllOutbound: true,
      description: 'Allows all outbound traffic to facilitate s3Copy'
    })

    sg.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(2049), 'data within the vpc')

    /**
     * Events Bridge spins up ECS Task
     */
    const target = new eventTarget.EcsTask({
      cluster,
      taskDefinition,
      securityGroups: [sg],
      assignPublicIp: false,
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
              name: 'S3_BUCKET', value: bucketName
            },
            {
              name: 'ENVIRONMENT_NAME', value: envName
            },
          ]
        },
      ],
      propagateTags: ecs.PropagatedTagSource.TASK_DEFINITION
    })
    /**
     * Cron job launch Fargate task
     */
    new events.Rule(this, "cronJobTriggerECS", {
      schedule: events.Schedule.cron({ minute: '0', hour: '3' }),
      targets: [target],
      description: 'Runs daily at specific time',
    })

    /**
     * Notify SNS if fails
     */
    const filterFailedECSRule = new events.Rule(this, "filterFailedEFSBackup", {
      eventPattern: {
        source: ["aws.ecs"],
        detailType: ["ECS Task State Change"],
        detail: {
          "containers": {
            "exitCode": [1, 32, 137, 139, 255]
          },
          "lastStatus": [
            "STOPPED"
          ],
          "stoppedReason": [
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