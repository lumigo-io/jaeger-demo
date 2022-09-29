const { awscdk } = require('projen');
const project = new awscdk.AwsCdkTypeScriptApp({
  cdkVersion: '2.43.0',
  defaultReleaseBranch: 'main',
  name: 'otel-resource-attributes-demo',
  deps: ['cdk8s'],
  devDeps: ['@types/aws-lambda', 'esbuild'],
});
project.synth();