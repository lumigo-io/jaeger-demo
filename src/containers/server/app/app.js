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
    res.status(200).send('OK');
  });
  
  app.get('/api/greetings', async (req, res) => {
    const r = Math.random();
    if (r * 100 < failureRate) {
      res.status(200).send('Hello World');
    } else {
      res.status(500).send('Having a bad minute!');
    }
  });
  
  app.listen(process.env.SERVER_PORT || 5000, '0.0.0.0');
})();
