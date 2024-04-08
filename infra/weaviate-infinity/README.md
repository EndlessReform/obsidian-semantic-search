## Weaviate + Nomic embeddings + Infinity Inference

A Docker Compose stack with everything you need to self-host the backend for this plugin.

Stack:

-   [Weaviate](https://weaviate.io) vector database
-   Nomic embeddings, using [Infinity](http://michaelfeil.eu/infinity/latest/) inference server

## System requirements

-   Nvidia GPU with CUDA drivers
-   Docker
-   Docker Compose
-   [Nvidia Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html). If you don't have an Nvidia card and don't mind slower processing, take out the `deploy` block.

Linux strongly recommended; only tested on Ubuntu 22.04.

## Setup

Start stack:

```bash
docker compose up --build -d
```

Note that we can't pull the Infinity image directly, since to get Nomic embeddings to work, Infinity [has to be monkey-patched](https://github.com/michaelfeil/infinity/discussions/128) to add a low-level dependency.

Then in plugin settings:

TODO
