#!/bin/sh
# Save Docker environment for crond (crond runs with empty env)
export -p > /tmp/docker_env.sh
exec crond -f
