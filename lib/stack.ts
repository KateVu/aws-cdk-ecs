import { core, base, ec2, iam, ecr, account, ecs, log } from '@nib-group/rqp-cdk'
import { getPhysicalResourceIdFromStack, getSNSTopics } from './helper'

export default class EFSBackupToS3Stack extends core.RqpStack {
  constructor(scope: core.RqpApp, props?: core.RqpStackProps) {
    super(scope, 'EFSBackupToS3Stack', props)

    const archiveBucketName = `nib-${scope.rqpCtx.stage}-${scope.rqpCtx.zone}-backups-archive-${scope.rqpCtx.region}`
    const archiveBucket = base.aws_s3.Bucket.fromBucketName(this, 'archiveBucketName', archiveBucketName)
    const backKmsKeyAlias = 'nib-rqp-whics-backups'

    const auditBucketName = 'nib-audit-backups-archive-ap-southeast-2' //TODO: need to update bucket policy later
    const auditKmsKeyArn = 'arn:aws:kms:ap-southeast-2:785810436068:key/56149550-16e7-479b-b2ba-b68e1b42fd6c'
    const auditBucket = base.aws_s3.Bucket.fromBucketName(this, 'auditBucketName', auditBucketName)
    
    const vpc = ec2.RqpVpc.fromExisting(this, 'Vpc')
    
    const privateSubnets = vpc.selectSubnets({
      subnetGroupName: ec2.RqpSubnetName3Tier.PRIVATE
    })

    //Task Execution Role
    const executionRole = new iam.RqpRole(this, 'executionRole', {
      assumedBy: new base.aws_iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        base.aws_iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    })

    /**
     * Permission for ecs task
     */
    const taskRole = new iam.RqpRole(this, 'taskRole', {
      assumedBy: new base.aws_iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        base.aws_iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')
      ]
    })    
    //Bucket policy to allow read+write
    taskRole.addToPolicy(new base.aws_iam.PolicyStatement({
      effect: base.aws_iam.Effect.ALLOW,
      actions: [
        's3:Get*',
        's3:ListBucket*',
        's3:PutObject*'
      ],
      resources: [
        archiveBucket.bucketArn,
        `${archiveBucket.bucketArn}/*`
      ]
    }))

    const backupArchiveKmsKey = base.aws_kms.Key.fromLookup(this, 'backupKmsKey', {
      aliasName: `alias/${backKmsKeyAlias}`
    })

    taskRole.addToPolicy(new base.aws_iam.PolicyStatement({
      effect: base.aws_iam.Effect.ALLOW,
      actions: [
        "kms:Encrypt",
        "kms:DescribeKey",
        "kms:GenerateDataKeyWithoutPlaintext",
        "kms:GenerateDataKey"              
      ],
      resources: [
        backupArchiveKmsKey.keyArn
      ]
    }))
    taskRole.addToPolicy(new base.aws_iam.PolicyStatement({
      effect: base.aws_iam.Effect.ALLOW,
      actions: [
        'ssm:PutParameter*',
        'ssm:GetParameter*',
        'ssm:DescribeParameters',
      ],
      resources: [
        'arn:aws:ssm:*:*:parameter/s3copy/secret'
      ]
    }))

    //Events bridge rule role
    const eventsRole = new base.aws_iam.Role(this, 'eventsRuleRole', {
      assumedBy: new base.aws_iam.ServicePrincipal('events.amazonaws.com')
    })
    eventsRole.addManagedPolicy(base.aws_iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2ContainerServiceEventsRole'))
   
    //Granting ECS role permission
    executionRole.grantPassRole(eventsRole)
    taskRole.grantPassRole(eventsRole)

    /**
     * Get EFS file system id from whics app stack with same slice and stage
     */
    const importedFileSystemID = getPhysicalResourceIdFromStack(scope.rqpCtx.region, `rqp-whics-app-${scope.rqpCtx.zone}-${scope.rqpCtx.slice}-stack`, 'AWS::EFS::FileSystem', false)
    if (importedFileSystemID == '') {
      throw new Error(`Cannot find EFS File system ID from stack rqp-whics-app-${scope.rqpCtx.zone}-${scope.rqpCtx.slice}-stack`)
    }
    console.log("importedFileSystem:", importedFileSystemID)

    /**
     * Task definition
     */
    const taskDefinition = new ecs.RqpFargateTaskDefinition(this, 'taskDefinition', {
      //4GB Ram - Between 4096 (4 GB) and 16384 (16 GB) in increments of 1024 (1 GB) - Available cpu values: 2048 (2 vCPU)
      memoryLimitMiB: 8192,
      //2 vCPU
      cpu: 2048,
      taskRole: taskRole,
      executionRole: executionRole,
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

    const ecrRepo = ecr.RqpRepository.fromEcrImage(this, 'ecrRepo', {
      name: scope.rqpCtx.application,
      tag: scope.rqpCtx.applicationVersion,
      region: core.RqpRegion.AP_SOUTHEAST_2,
      registry: account.RqpAccount.CONTROL_GENERAL
    })

    const logGroup = new log.RqpLambdaLoggerLogGroup(this, 'LogGroup', {retention: 7})
    
    /**
     * Containter
     */
    const container = taskDefinition.addContainer('taskDefinitionContainer', {
      image: new base.aws_ecs.EcrImage(ecrRepo, scope.rqpCtx.applicationVersion),
      environment: {
        RQP_REPOSITORY: scope.rqpCtx.repository,
        RQP_APPLICATION: scope.rqpCtx.application,
        RQP_APPLICATION_VERSION: scope.rqpCtx.applicationVersion,
        RQP_REGION: scope.rqpCtx.region,
        RQP_STAGE: scope.rqpCtx.stage,
        RQP_ZONE: scope.rqpCtx.zone,
        RQP_SLICE: scope.rqpCtx.slice,
        COMPANY: 'nib',
        DAYS: '2'
      },
      logging: base.aws_ecs.LogDrivers.awsLogs({ logGroup: logGroup, streamPrefix: 'ecs' }),
    })

    container.addMountPoints(
      {
        sourceVolume: 'efs',
        containerPath: '/mnt/whicsefs',
        readOnly: false        
      }
    )

    //Cluster
    const cluster = new ecs.RqpCluster(this, 'cluster', {
      vpc
    })

    //Security Group
    const sg = new ec2.RqpSecurityGroup(this, 'EcsEgressSg', {
      vpc,
      allowAllOutbound: true,
      description: 'Allows all outbound traffic to facilitate s3Copy'
    })
    
    /**
     * Find sg created from app build to access to EFS
     */
    const efsAppSg = ec2.RqpSecurityGroup.fromLookupByName(this, 'efsAppSg', `rqp-whics-app-${scope.rqpCtx.zone}-${scope.rqpCtx.slice}-efsSgForFargate`, vpc)
    console.log("efsAppSg:", efsAppSg.securityGroupId)
    
    const snstopicsArn = getSNSTopics(this)

    /**
     * Events Bridge spins up ECS Task for archive bucket
     */
    const targetArchive = new base.aws_events_targets.EcsTask({
      cluster,
      taskDefinition,
      securityGroups: [sg, efsAppSg],
      subnetSelection: privateSubnets,
      platformVersion: base.aws_ecs.FargatePlatformVersion.VERSION1_4,
      role: eventsRole,
      containerOverrides: [
        {
          containerName: container.containerName,
          environment: [
            {
              name: 'S3_BUCKET', value:  archiveBucket.bucketName
            },
            {
              name: 'KMS_KEY_ARN', value:  'false'
            },
            {
              name: 'KMS_KEY', value:  'nib-rqp-whics-backups'
            }
          ]
        },
      ],
      propagateTags: base.aws_ecs.PropagatedTagSource.TASK_DEFINITION
    })
    /**
     * Cron job trigger backup to archive bucket
     */
    new base.aws_events.Rule(this, "cronJobTriggerArchive", {
      //1:00AM AEST - temporary
      schedule: base.aws_events.Schedule.cron({minute: '0', hour: '15'}),
      targets: [targetArchive],
      description: 'Runs daily at specific time',
    })

    /**
     * Grant access to audit bucket and ksm key for prod prod
     * Create new target and rule to trigger backup for audit bucket
     */
    if (scope.rqpCtx.stage == 'prod' && scope.rqpCtx.slice == 'prod') {

      taskRole.addToPolicy(new base.aws_iam.PolicyStatement({
        effect: base.aws_iam.Effect.ALLOW,
        actions: [
          's3:Get*',
          's3:ListBucket*',
          's3:PutObject*'
        ],
        resources: [
          auditBucket.bucketArn,
          `${auditBucket.bucketArn}/*`
        ]
      }))
      taskRole.addToPolicy(new base.aws_iam.PolicyStatement({
        effect: base.aws_iam.Effect.ALLOW,
        actions: [
          "kms:Encrypt",
          "kms:DescribeKey",
          "kms:GenerateDataKeyWithoutPlaintext",
          "kms:GenerateDataKey"              
        ],
        resources: [ auditKmsKeyArn ]
      }))

      /**
       * Events Bridge spins up ECS Task for audit bucket
       */
      const targetAudit = new base.aws_events_targets.EcsTask({
        cluster,
        taskDefinition,
        securityGroups: [sg, efsAppSg],
        subnetSelection: privateSubnets,
        platformVersion: base.aws_ecs.FargatePlatformVersion.VERSION1_4,
        role: eventsRole,
        containerOverrides: [
          {
            containerName: container.containerName,
            environment: [
              {
                name: 'S3_BUCKET', value:  auditBucket.bucketName
              },
              {
                name: 'KMS_KEY_ARN', value:  'true'
              },
              {
                name: 'KMS_KEY', value:  auditKmsKeyArn
              }
            ]
          },
        ],
        propagateTags: base.aws_ecs.PropagatedTagSource.TASK_DEFINITION
      })
      /**
       * Cron job trigger backup to archive bucket
       */
      new base.aws_events.Rule(this, "cronJobTriggerAudit", {
        //3:00AM AE - temporary - we set the backup at 1AM, and it takes ~1.5h to run
        schedule: base.aws_events.Schedule.cron({minute: '0', hour: '17'}),
        targets: [targetAudit],
        description: 'Runs daily at specific time',
      })

    }

    /**
     * Event bridge rule for failed AWS Batch which has SNS above as target
     * Copy rqp-rds-backups-to-s3 repo
     */
    const filterFailedECSRule = new base.aws_events.Rule(this, "filterFailedEFSBackup", {
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

    const snsTopic = base.aws_sns.Topic.fromTopicArn(this, 'failedSNSTopic', snstopicsArn)
    //Add SNS as target
    filterFailedECSRule.addTarget(new base.aws_events_targets.SnsTopic(snsTopic))    
  }
}
