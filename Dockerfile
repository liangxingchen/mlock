FROM registry.cn-hangzhou.aliyuncs.com/miaomo/node:24.13.0

RUN npm install -g mlock-server@0.2.0

ENTRYPOINT ["mlock-server"]

EXPOSE 12340
