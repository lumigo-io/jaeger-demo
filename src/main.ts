import { join } from 'path';
import { App, Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Vpc } from 'aws-cdk-lib/aws-ec2';
import { AwsLogDriver, Cluster, ContainerImage, FargateService, FargateTaskDefinition, LogDrivers, Protocol, Secret as EcsSecret } from 'aws-cdk-lib/aws-ecs';
import { ApplicationProtocol, Protocol as AlbProtocol } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { ApplicationLoadBalancedFargateService, ApplicationMultipleTargetGroupsFargateService } from 'aws-cdk-lib/aws-ecs-patterns';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

interface JaegerStackProps extends StackProps {
  readonly vpc: Vpc;
}

class JaegerStack extends Stack {
  readonly collectorUrl: string;

  constructor(scope: Construct, id: string, props: JaegerStackProps) {
    super(scope, id, props);

    const cluster = new Cluster(this, 'OtelResourceAttributesDemoCluster', {
      containerInsights: true,
      vpc: props.vpc,
    });

    const uiListenerName = 'ui';
    const uiPort = 16686;
    const collectorListenerName = 'collector';
    const collectorPort = 14268;

    // Create a load-balanced Fargate service and make it public
    const jaegerService = new ApplicationMultipleTargetGroupsFargateService(this, 'JaegerService', {
      cluster,
      cpu: 1024,
      desiredCount: 1,
      taskImageOptions: {
        image: ContainerImage.fromRegistry('jaegertracing/all-in-one:1.38'),
        logDriver: LogDrivers.awsLogs({
          streamPrefix: id,
          logRetention: RetentionDays.ONE_DAY,
        }),
        containerPorts: [
          collectorPort, // HTTP; collector
          uiPort, // HTTP; frontend
        ]
      },
      memoryLimitMiB: 4096,
      loadBalancers: [
        {
          name: 'Jaeger',
          listeners: [
            {
              name: collectorListenerName,
              port: collectorPort,
            },
            {
              name: uiListenerName,
              protocol: ApplicationProtocol.HTTP,
            },
          ],
        },
      ],
      targetGroups: [
        {
          listener: collectorListenerName,
          containerPort: collectorPort,
          protocol: Protocol.TCP,
        },
        {
          listener: uiListenerName,
          containerPort: uiPort,
          protocol: Protocol.TCP,
        },
      ],
    });
    /*
     * We cannot access the second target group (the UI) because of
     * shotcomings in the ApplicationMultipleTargetGroupsFargateService
     * construct, but it will have a default health check on '/' that
     * will work.
     */
    jaegerService.targetGroup.configureHealthCheck({
      path: '/',
      interval: Duration.seconds(10),
      unhealthyThresholdCount: 5,
      port: String(uiPort),
      protocol: AlbProtocol.HTTP,
    });

    this.collectorUrl = `http://${jaegerService.loadBalancer.loadBalancerDnsName}:${collectorPort}/api/traces`;
  };
}

interface DemoApplicationStackProps extends StackProps {
  readonly vpc: Vpc,
  readonly deployment: string;
  readonly failureRate: number;
  readonly jaegerCollectorEndpoint: string;
}

class DemoApplicationStack extends Stack {

  constructor(scope: Construct, id: string, props: DemoApplicationStackProps) {
    super(scope, id, props);

    const cluster = new Cluster(this, `OtelResourceAttributesDemoApplication${props.deployment.toUpperCase()}Cluster`, {
      containerInsights: true,
      vpc: props.vpc,
    });

    const lumigoTokenSecret = EcsSecret.fromSecretsManager(Secret.fromSecretNameV2(this, 'Secret', 'AccessKeys'), 'LumigoToken');

    const serverPort = 80;

    const serverTaskDefinition = new FargateTaskDefinition(this, `ServerTask${props.deployment.toUpperCase()}Def`);
    serverTaskDefinition.addContainer('serverApp', {
      image: ContainerImage.fromAsset(join(__dirname, 'containers/server'), {
        platform: Platform.LINUX_AMD64,
      }),
      memoryReservationMiB: 256,
      environment: {
        OTEL_EXPORTER_JAEGER_ENDPOINT: `${props.jaegerCollectorEndpoint}`,
        OTEL_RESOURCE_ATTRIBUTES: `deployment=${props.deployment}`,
        OTEL_SERVICE_NAME: 'http-server', // This will be the service name in Lumigo
        // LUMIGO_DEBUG_SPANDUMP: '/dev/stdout',
        SERVER_PORT: String(serverPort),
        FAILURE_RATE: String(props.failureRate || 0),
      },
      secrets: {
        LUMIGO_TRACER_TOKEN: lumigoTokenSecret,
      },
      logging: new AwsLogDriver({ streamPrefix: 'server-app' }),
      portMappings: [
        {
          containerPort: serverPort,
          protocol: Protocol.TCP,
        },
      ],
    });

    const serverService = new ApplicationLoadBalancedFargateService(this, `ServerService${props.deployment.toUpperCase()}`, {
      cluster: cluster,
      taskDefinition: serverTaskDefinition,
      desiredCount: 1,
      listenerPort: serverPort,
      publicLoadBalancer: true,
    });
    serverService.targetGroup.configureHealthCheck({
      path: '/health',
      interval: Duration.seconds(10),
      unhealthyThresholdCount: 5,
      port: String(serverPort),
    }); 

    const clientTaskDefinition = new FargateTaskDefinition(this, `ClientTaskDef${props.deployment.toUpperCase()}`);
    clientTaskDefinition.addContainer('clientApp', {
      image: ContainerImage.fromAsset(join(__dirname, 'containers/client'), {
        platform: Platform.LINUX_AMD64,
      }),
      memoryReservationMiB: 256,
      environment: {
        OTEL_EXPORTER_JAEGER_ENDPOINT: `${props.jaegerCollectorEndpoint}`,
        OTEL_RESOURCE_ATTRIBUTES: `deployment=${props.deployment}`,
        OTEL_SERVICE_NAME: 'http-client', // This will be the service name in Lumigo
        TARGET_URL: `http://${serverService.loadBalancer.loadBalancerDnsName}/api/greetings`,
      },
      secrets: {
        LUMIGO_TRACER_TOKEN: lumigoTokenSecret,
      },
      logging: new AwsLogDriver({ streamPrefix: 'client-app' }),
    });
    // TODO Add healthcheck

    new FargateService(this, `ClientService${props.deployment.toUpperCase()}`, {
      cluster,
      taskDefinition: clientTaskDefinition,
      capacityProviderStrategies: [
        {
          capacityProvider: 'FARGATE_SPOT',
          weight: 2,
        },
        {
          capacityProvider: 'FARGATE',
          weight: 1,
        },
      ],
      desiredCount: 1,
    });
  }
}

interface DemoApplicationDeployment {
  deployment: string;
  failureRate: number;
}

class DemoStack extends Stack {
  
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    const vpc = new Vpc(this, 'OtelResourceAttributesDemoVpc', {
      maxAzs: 2 // Default is all AZs in region
    });

    const jaegerService = new JaegerStack(this, 'jaeger-backend',{
      env,
      vpc,
      tags: {
        'LUMIGO_TAG': 'lumigo-jaeger-demo',
      },
    });
    const jaegerCollectorEndpoint = jaegerService.collectorUrl;

    const deployments: Array<DemoApplicationDeployment> = [
      {
        deployment: 'qa',
        failureRate: 0,
      },
      {
        deployment: 'prod',
        failureRate: 50,
      },
    ];

    deployments.forEach(demoSetup => {
      new DemoApplicationStack(this, `app-${demoSetup.deployment.toLowerCase()}`, {
        env: {
          account: process.env.CDK_DEFAULT_ACCOUNT,
          region: process.env.CDK_DEFAULT_REGION,
        },
        vpc,
        deployment: demoSetup.deployment,
        failureRate: demoSetup.failureRate,
        jaegerCollectorEndpoint,
        tags: {
          'LUMIGO_TAG': 'lumigo-jaeger-demo',
        }
      });
    });
  }

}

// for development, use account/region from cdk cli
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const app = new App();

new DemoStack(app, 'otel-ra-demo', {
  env,
  tags: {
    LUMIGO_TAG: `lumigo-jaeger-demo`,
  },
});

app.synth();
