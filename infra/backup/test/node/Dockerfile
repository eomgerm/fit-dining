# 시험용 서버(A와 B 역할 모두)다. 실제 서버에서 쓰는 도구(age, rsync, rrsync, ssh)를 갖추고 Docker CLI는 소켓으로 호스트의 데몬을 쓴다.
FROM docker:29.9.0-cli AS dockercli

FROM ubuntu:24.04
# hadolint ignore=DL3008
RUN apt-get update \
 && apt-get install -y --no-install-recommends age rsync openssh-server openssh-client ca-certificates python3 sudo \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd docker \
 && useradd --create-home --shell /bin/bash --groups docker runner
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
CMD ["sleep", "infinity"]
