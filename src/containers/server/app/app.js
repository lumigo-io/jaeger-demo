const { init } = require('@lumigo/opentelemetry');
const { JaegerExporter } = require('@opentelemetry/exporter-jaeger');
const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');

(async () => {
  const { tracerProvider } = await init;
  
  tracerProvider.addSpanProcessor(new BatchSpanProcessor(new JaegerExporter({})));
  
  const failureRate = process.env.FAILURE_RATE;
  
  const express = require('express');
  const app = express();
  
  app.get('/health', async (req, res) => {
    res.send('OK').status(200);
  });
  
  app.get('/api/greetings', async (req, res) => {
    const r = Math.random();
    if (r * 100 < failureRate) {
      res.send('Hello World').status(200);
    } else {
      res.send('Having a bad minute!').status(500);
    }
  });
  
  app.listen(process.env.SERVER_PORT || 5000, '0.0.0.0');
})();
