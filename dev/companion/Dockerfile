# The video companion's test runner: the Playwright image (a Chromium) plus Ubuntu's full
# ffmpeg (libx264, libvpx-vp9, prores_ks) — what Ryan's OBS machine has and the Playwright
# image's trimmed ffmpeg does not.
FROM mcr.microsoft.com/playwright:v1.64.1-noble
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
