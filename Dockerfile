FROM node:6-alpine

WORKDIR /app

# Order of execution matters - prevents unnecessary cache invalidation
COPY package.json .

#For what environment the dependencies will be builded for.
#Eg. if NODE_ENV=production, no devDependencies are included
ARG NODE_ENV=test

ADD https://raw.githubusercontent.com/fogine/wait-for-it/master/wait-for-it.sh /wait-for-it.sh
RUN chmod a+x /wait-for-it.sh

# Prepare the env for building native dependencies
# This will NOT increase final docker image size as additional dependencies
# are removed after npm install
RUN  apk update  \
  && apk upgrade \
  && apk --no-cache add --virtual native-deps \
  g++ gcc libgcc libstdc++ linux-headers make python findutils postgresql-dev \
  && NODE_ENV=$NODE_ENV \
  && npm install --quiet \
  && apk add bash git  \
  && npm cache clean \
  # https://github.com/npm/npm/issues/4531
  && npm config set unsafe-perm true




CMD npm test
