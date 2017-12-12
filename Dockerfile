FROM node:8
MAINTAINER Sergiy Kukunin <sergiy.kukunin@gmail.com>

RUN apt-get update && apt-get install -y libboost-all-dev libssl-dev

WORKDIR /app

COPY package.json /app/package.json
RUN npm install

COPY . /app

RUN useradd -ms /bin/bash app && \
    mkdir /data && chown app.app /data && \
    ln -s /data/config.json /app/config.json && \
    chown -R app.app /app

USER app

VOLUME /data

CMD ["/usr/local/bin/node", "init.js"]