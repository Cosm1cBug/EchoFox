# Building EchoFox for multiple architectures

Our published images (`ghcr.io/cosm1cbug/echofox`, `cosm1cbug/echofox`) ship
for **`linux/amd64`** and **`linux/arm64`** — covering x86 servers, Apple
Silicon, AWS Graviton, and Raspberry Pi 4/5.

If you're building your own (forking, customising, or air-gapped), here's how.

---

## One-shot local build (single platform)

```bash
docker build -t echofox:local .
```

Builds for whatever architecture your machine is. Fine for `docker run`
on the same host.

---

## Multi-arch build with buildx

Buildx ships with Docker Desktop and modern Docker Engine. On Linux it
requires QEMU for cross-architecture emulation.

### Setup (one-time)

```bash
# Install QEMU emulation
docker run --privileged --rm tonistiigi/binfmt --install all

# Create a buildx builder
docker buildx create --name echofox-builder --use --bootstrap

# Verify
docker buildx ls
```

### Build and load locally (single arch — your host)

```bash
docker buildx build --load -t echofox:local .
```

### Build and push (multi-arch)

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag ghcr.io/cosm1cbug/echofox:dev \
  --tag ghcr.io/cosm1cbug/echofox:latest \
  --push \
  .
```

You must be `docker login`ed to GHCR first:

```bash
echo $GITHUB_TOKEN | docker login ghcr.io -u Cosm1cBug --password-stdin
```

### Build and save to a tar (air-gapped)

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --output type=oci,dest=echofox-image.tar \
  .
```

---

## Pushing to Docker Hub *and* GHCR in one command

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag ghcr.io/cosm1cbug/echofox:v0.3.0-alpha \
  --tag ghcr.io/cosm1cbug/echofox:latest \
  --tag cosm1cbug/echofox:v0.3.0-alpha \
  --tag cosm1cbug/echofox:latest \
  --push \
  .
```

Make sure you've `docker login`ed to **both** registries first.

---

## Verifying

```bash
docker buildx imagetools inspect ghcr.io/cosm1cbug/echofox:latest
# Should list manifests for linux/amd64 AND linux/arm64
```

---

## CI automation (M4)

The release workflow (coming in Milestone M4) will do all of this
automatically on every tag push. For now it's a manual process.
