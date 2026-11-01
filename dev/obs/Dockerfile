# A headless OBS Studio for testing the video companion (#96, #98): the obsproject PPA's OBS
# (32.x on noble — the same line as a current Windows install, obs-websocket built in) under
# Xvfb with software GL, exeldro's Source Record filter (the independent per-race recording,
# #98), a profile that records x264 to /recordings, a scene collection with the program
# scene and a "Clean" scene carrying the filter, and the WebSocket server on :4455 (password
# "gridfpv"). Nothing here is tuned for quality; it is an OBS that answers.
FROM ubuntu:noble
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends software-properties-common ca-certificates curl \
 && add-apt-repository -y ppa:obsproject/obs-studio \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      obs-studio xvfb xauth x11-utils dbus dbus-x11 \
      libgl1-mesa-dri libegl1 libglx-mesa0 libegl-mesa0 \
      fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/* \
 && dbus-uuidgen > /etc/machine-id
# Source Record (https://github.com/exeldro/obs-source-record), pinned; its Linux tarball
# uses the classic layout: bin/64bit/<plugin>.so and data/ beside it.
ARG SOURCE_RECORD_VERSION=0.4.8
ARG SOURCE_RECORD_SHA256=
RUN set -eux; \
    curl -fsSL -o /tmp/sr.tar.gz "https://github.com/exeldro/obs-source-record/releases/download/${SOURCE_RECORD_VERSION}/source-record-${SOURCE_RECORD_VERSION}-ubuntu-22.04.tar.gz"; \
    if [ -n "$SOURCE_RECORD_SHA256" ]; then echo "$SOURCE_RECORD_SHA256  /tmp/sr.tar.gz" | sha256sum -c -; fi; \
    mkdir -p /tmp/sr && tar -xzf /tmp/sr.tar.gz -C /tmp/sr; \
    install -D -m 644 /tmp/sr/source-record/bin/64bit/source-record.so /usr/lib/x86_64-linux-gnu/obs-plugins/source-record.so; \
    mkdir -p /usr/share/obs/obs-plugins/source-record && cp -r /tmp/sr/source-record/data/. /usr/share/obs/obs-plugins/source-record/; \
    rm -rf /tmp/sr /tmp/sr.tar.gz
# uid 1000 (the image's `ubuntu` user) so files in the bind-mounted /recordings belong to the usual host user.
RUN mkdir -p /recordings /home/ubuntu/.config && chown -R ubuntu:ubuntu /recordings /home/ubuntu
COPY --chown=ubuntu:ubuntu config/ /home/ubuntu/.config/obs-studio/
COPY entrypoint.sh /usr/local/bin/obs-entrypoint
USER ubuntu
WORKDIR /home/ubuntu
ENV QT_QPA_PLATFORM=xcb LIBGL_ALWAYS_SOFTWARE=1 HOME=/home/ubuntu XDG_RUNTIME_DIR=/tmp/runtime-ubuntu
EXPOSE 4455
HEALTHCHECK --interval=5s --timeout=3s --start-period=20s --retries=12 \
  CMD bash -c '</dev/tcp/127.0.0.1/4455' || exit 1
ENTRYPOINT ["/usr/local/bin/obs-entrypoint"]
