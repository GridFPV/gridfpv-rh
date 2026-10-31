# A headless OBS Studio for testing the video companion (#96): Ubuntu's obs-studio 30 (its
# obs-websocket built in) under Xvfb with software GL, a profile that records x264 to
# /recordings, one scene with a colour source, and the WebSocket server on :4455 (password
# "gridfpv"). Nothing here is tuned for quality; it is an OBS that answers.
FROM ubuntu:noble
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      obs-studio xvfb xauth x11-utils dbus dbus-x11 \
      libgl1-mesa-dri libegl1 libglx-mesa0 libegl-mesa0 \
      fonts-dejavu-core ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && dbus-uuidgen > /etc/machine-id
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
