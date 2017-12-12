#!/bin/bash
set -x -e
docker build -t kukunin/node-cryptonote-pool:latest .
docker push kukunin/node-cryptonote-pool:latest