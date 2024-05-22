FROM --platform=linux/amd64 alpine:latest
# Create app directory
WORKDIR /usr/src/app

RUN apk --update add py-pip jq bash aws-cli && \
rm -rf /var/cache/apk/*

COPY ./batchjob.py ./

ADD ./entrypoint.sh /usr/bin/app/
RUN chmod +x /usr/bin/app/entrypoint.sh
ENTRYPOINT ["/bin/bash", "/usr/bin/app/entrypoint.sh"]