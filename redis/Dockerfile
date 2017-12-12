FROM redis:latest
MAINTAINER windy(xfstudio@qq.com)

# docker run --name redis-master -v /docker/host/dir:/data -d redis redis-server --appendonly yes

COPY redis.conf /usr/local/etc/redis/redis.conf
CMD [ "redis-server", "/usr/local/etc/redis/redis.conf" ]
#CMD [ "redis-server"]