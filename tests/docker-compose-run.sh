#!/bin/sh

# must be executed in project's root
#important, different project name causes a different set of ephemeral
#containers to be created so  that your local dev containers are not touched
#or deleted
export COMPOSE_PROJECT_NAME=$(basename `pwd`)"-test"

docker-compose run --rm --name $COMPOSE_PROJECT_NAME test

exit_code=$?

docker-compose down -v
exit $exit_code
