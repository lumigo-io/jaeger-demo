FROM node:16

WORKDIR /code

COPY ./package.json /code/package.json

RUN npm i

COPY ./app /code/app

# Activate the Lumigo instrumentation
ENV NODE_OPTIONS='-r @lumigo/opentelemetry'

CMD ["npm", "run", "start"]