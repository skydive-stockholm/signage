# Server installation

```bash
curl -o- https://raw.githubusercontent.com/skydive-stockholm/signage/main/install-server.sh | bash
```

# Player installation
```bash
curl -o- https://raw.githubusercontent.com/skydive-stockholm/signage/main/install-player.sh | bash
```

> [!IMPORTANT]
> **Raspberry Pi 1 & 2 (and original Pi Zero):** flash the Pi with the
> **Bullseye** Raspberry Pi OS Lite image before running the player installer.
> Bookworm/Trixie ship a Chromium build that requires NEON SIMD, which these
> ARMv6 boards don't have — Chromium refuses to launch and you get a black
> screen.
>
> Use this image:
>
> https://downloads.raspberrypi.com/raspios_oldstable_lite_armhf/images/raspios_oldstable_lite_armhf-2025-05-07/2025-05-06-raspios-bullseye-armhf-lite.img.xz
>
> Pi 3 / 4 / 5 / 400 / Zero 2 W: use the current Raspberry Pi OS — no special steps.
