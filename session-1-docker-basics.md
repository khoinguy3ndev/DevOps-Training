# Session 1 — Docker & Container Basics

**Duration:** ~3 hours  
**Prerequisites:** Basic command-line usage, familiarity with any backend language

---

## Part 1 — Standard: Core Concepts

### 1.1 Where Does an Application Run?

When you write code on your laptop and share it with a teammate, you've probably heard:

> "It works on my machine."

This happens because applications depend on a specific **runtime environment**:
- Operating system version
- Installed libraries and their versions
- Environment variables
- File paths

**Local vs Server:**

| | Local (Dev) | Server (Prod) |
|---|---|---|
| OS | macOS / Windows | Usually Linux |
| Runtime | Installed manually | Varies |
| Config | .env file | CI/CD secrets |
| Risk | Low | High |

The challenge: ensuring that what runs locally also runs identically on a server.

---

### 1.2 Virtual Machine vs Container

Both VMs and containers solve the "works on my machine" problem, but in different ways.

**Virtual Machine (VM):**
- Emulates an entire physical computer
- Includes a full OS (kernel + userspace)
- Isolated but **heavy** — can take GBs and minutes to boot

**Container:**
- Shares the host OS kernel
- Packages only the app + its dependencies
- **Lightweight** — starts in seconds, uses MBs

```
┌─────────────────────────────────┐
│         VM Architecture         │
│  ┌────────┐  ┌────────┐        │
│  │ App A  │  │ App B  │        │
│  │ OS     │  │ OS     │        │
│  └────────┘  └────────┘        │
│       Hypervisor                │
│       Physical Hardware         │
└─────────────────────────────────┘

┌─────────────────────────────────┐
│      Container Architecture     │
│  ┌────────┐  ┌────────┐        │
│  │ App A  │  │ App B  │        │
│  │ Libs   │  │ Libs   │        │
│  └────────┘  └────────┘        │
│       Docker Engine             │
│       Host OS (shared kernel)   │
│       Physical Hardware         │
└─────────────────────────────────┘
```

**Key takeaway:** Containers are not VMs. They share the kernel and are significantly lighter.

---

### 1.3 Why Docker?

Docker is the most widely used container runtime. It solves the environment consistency problem by packaging everything an app needs into a **Docker image** — a portable, immutable snapshot.

**Core concepts:**

| Term | Description |
|---|---|
| **Dockerfile** | Recipe to build an image |
| **Image** | Built snapshot (read-only) |
| **Container** | Running instance of an image |
| **Registry** | Storage for images (e.g., Docker Hub, ECR) |

**Lifecycle:**
```
Dockerfile → build → Image → run → Container
```

---

## Part 2 — Standard: Hands-On

### 2.1 Install Docker

Make sure Docker is installed:

```bash
docker --version
docker compose version
```

If not installed: https://docs.docker.com/get-docker/

---

### 2.2 Write a Dockerfile for a Backend App

We'll use a simple Node.js + Express API as our example app.

**Project structure:**
```
my-app/
├── Dockerfile
├── compose.yaml
├── tsconfig.json
├── package.json
├── package-lock.json
└── src/
    └── index.ts
```

**`src/index.ts`:**
```ts
import express, { Request, Response } from 'express';

const app = express();
const PORT = process.env.PORT ?? 3000;

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', env: process.env.NODE_ENV });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
```

**`package.json`:**
```json
{
  "name": "my-app",
  "version": "1.0.0",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node src/index.ts"
  },
  "dependencies": {
    "express": "5.2.1"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "^24.0.0",
    "typescript": "^5.8.0",
    "ts-node": "^10.9.0"
  }
}
```

**`tsconfig.json`:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**`Dockerfile`:**
```dockerfile
FROM node:24

WORKDIR /app

# Copy dependency files first (layer caching)
COPY package*.json ./
RUN npm install

# Copy TypeScript config and source
COPY tsconfig.json ./
COPY src ./src

# Compile TypeScript → JavaScript
RUN npm run build

EXPOSE 3000
CMD ["node", "dist/index.js"]
```

> **Why copy `package.json` first?**  
> Docker caches each layer. If only source code changes, the `npm install` layer is reused — making rebuilds faster.

**Build the image:**
```bash
docker build -t my-app:latest .
```

**Run a container from the image:**
```bash
docker run -p 3000:3000 my-app:latest
```

Test it:
```bash
curl http://localhost:3000/health
# {"status":"ok","env":null}
```

---

### 2.3 Run Docker Compose (Backend + Database + Redis)

Running multiple containers manually is painful. Docker Compose defines and manages a multi-container setup in one file.

> **Note:** Modern Docker Compose (v2+) uses `compose.yaml` as the canonical filename and drops the obsolete `version:` field. Use `depends_on` with `condition: service_healthy` to properly wait for dependencies instead of a simple list.

**`compose.yaml`:**
```yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=development
      - DATABASE_URL=postgres://user:password@db:5432/mydb
      - REDIS_URL=redis://redis:6379
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy

  db:
    image: postgres:18
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
      POSTGRES_DB: mydb
    volumes:
      - pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U user -d mydb"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s

  redis:
    image: redis:8-alpine
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
      start_period: 10s

volumes:
  pg_data:
  redis_data:
```

**Start everything:**
```bash
docker compose up --build
```

**Run in background (detached):**
```bash
docker compose up -d --build
```

**Check running containers:**
```bash
docker compose ps
```

**View logs:**
```bash
docker compose logs -f app
```

**Stop everything:**
```bash
docker compose down
```

**Stop and remove volumes (clean slate):**
```bash
docker compose down -v
```

---

### 2.4 Useful Docker Commands Reference

```bash
# List running containers
docker ps

# List all containers (including stopped)
docker ps -a

# List images
docker images

# Execute a command inside a running container
docker exec -it <container_name> sh

# Remove stopped containers
docker container prune

# Remove unused images
docker image prune
```

---

## Part 3 — Practice Exercises

### Exercise 1 — Add Nginx as a Reverse Proxy

Starting from the `compose.yaml` in section 2.3, add an nginx reverse proxy so that port `80` on the host routes traffic to the `app` service internally.

**Requirements:**
1. Add an `nginx` service using the `nginx:alpine` image
2. Map port `80` on the host to port `80` in the nginx container
3. Make the `app` service only reachable internally — remove the host port binding, expose only the container port
4. Create a custom nginx config that proxies all requests to the `app` service
5. Mount the nginx config file into the container
6. Ensure nginx starts only after `app` is running
7. Verify: `curl http://localhost/health` returns the expected JSON

---

### Exercise 2 — Debugging Containers

Run the following command to intentionally create a broken container:

```bash
docker run -d --name broken-app -e DATABASE_URL=wrong_url my-app:latest
```

Tasks:
1. Check if the container is running: `docker ps`
2. If it exited, inspect logs: `docker logs broken-app`
3. Shell into a running container to inspect environment variables: `docker exec -it broken-app sh`
4. Remove the container: `docker rm -f broken-app`

---

## Part 4 — Advanced

> Some advanced knowledge is good to know.

---

### Advanced 1 — Multi-Stage Builds

Multi-stage builds reduce the final image size by separating the **build** environment from the **runtime** environment. This is critical in production for security (no compiler toolchain in prod) and performance.

Starting from the Part 2 `Dockerfile`, the current single-stage build ships the full TypeScript compiler and `devDependencies` into production. A multi-stage build fixes this.

**Multi-stage `Dockerfile`:**
```dockerfile
# ── Stage 1: Builder (full image — includes compiler toolchain) ───────────
FROM node:24 AS builder

WORKDIR /app
COPY package*.json ./
# Install ALL deps (including devDependencies for tsc)
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

# Compile TypeScript → JavaScript
RUN npm run build

# ── Stage 2: Production Runtime (alpine — minimal) ────────────────────────
FROM node:24-alpine AS production

ENV NODE_ENV=production
WORKDIR /app

# Only install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled output from builder stage — no source, no devDeps, no compiler
COPY --from=builder /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/index.js"]
```

**Build and compare image sizes:**
```bash
# Part 2 single-stage image (node:24 full)
docker build -f Dockerfile -t my-app:dev .

# Part 4 multi-stage image (node:24-alpine runtime only)
docker build -f Dockerfile.multistage -t my-app:prod .

# Compare
docker images | grep my-app
```

You will see three factors compounding to shrink the production image: switching from `node:24` to `node:24-alpine` as the runtime base, stripping all `devDependencies`, and excluding the TypeScript source and compiler entirely.

**Challenge:** Update the `compose.yaml` from Part 2 to use the multi-stage Dockerfile for the `app` service and add a `target: production` build argument so development still uses the builder stage locally.

---

### Advanced 2 — Docker Layer Caching Strategy

Understanding Docker's build cache is essential for fast CI/CD pipelines.

**Rules:**
- Each `RUN`, `COPY`, `ADD` instruction creates a layer
- A layer is cached if the instruction AND all previous layers haven't changed
- `COPY . .` invalidates cache on every code change

**Optimized Dockerfile pattern:**

```dockerfile
FROM node:24-alpine
WORKDIR /app

# Layer 1: only invalidated when dependencies change
COPY package*.json ./
RUN npm ci --omit=dev

# Layer 2: only invalidated when app code changes
COPY src ./src
COPY tsconfig.json ./
RUN npm run build

EXPOSE 3000
CMD ["node", "dist/index.js"]
```

**Challenge:** Measure the difference:

```bash
# First build (cold cache)
time docker build -t cache-test .

# Make a change to src/index.ts (add a comment)
# Second build (warm cache)
time docker build -t cache-test .
```

Observe which steps say `CACHED` and how the total build time drops.

---

### Advanced 3 — Health Checks & Container Orchestration Readiness

In production orchestrators (ECS, Kubernetes), containers must report their own health.

**Add a health check to Dockerfile:**

```dockerfile
FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
EXPOSE 3000

# Health check: poll the /health endpoint every 30s
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
```

**Health check in `compose.yaml`:**

```yaml
services:
  app:
    build: .
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
    depends_on:
      db:
        condition: service_healthy  # wait for db to be healthy

  db:
    image: postgres:18
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U user -d mydb"]
      interval: 10s
      timeout: 5s
      retries: 5
```

**Challenge:** Add a health check to the `app` service in the Exercise 1 `compose.yaml`. Verify the health status with:

```bash
docker inspect --format='{{json .State.Health}}' <container_name> | jq
```

---

### Advanced 4 — Secrets & Environment Management

Hardcoding secrets in `compose.yaml` or `.env` files is a security risk. Learn the proper patterns.

**Pattern 1: `.env` file with Docker Compose**

```bash
# .env (never commit this)
POSTGRES_PASSWORD=supersecretpassword
JWT_SECRET=another_secret_value
```

```yaml
# compose.yaml
services:
  app:
    env_file:
      - .env
```

**Pattern 2: Docker Secrets (Swarm mode)**

```bash
echo "supersecretpassword" | docker secret create db_password -
```

```yaml
services:
  db:
    image: postgres:18
    secrets:
      - db_password
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password

secrets:
  db_password:
    external: true
```

**Challenge:** Refactor the `compose.yaml` from section 2.3 to:
1. Move all secrets to a `.env` file
2. Add `.env` to `.gitignore`
3. Create a `.env.example` with placeholder values for documentation

---

## ✅ Session 1 Outcomes

By the end of this session, you should be able to:

| Skill | Standard | Advanced |
|---|---|---|
| Explain the difference between VMs and containers | ✅ | ✅ |
| Write a Dockerfile for a backend app | ✅ | ✅ |
| Build and run a Docker image | ✅ | ✅ |
| Run a multi-service stack with Docker Compose | ✅ | ✅ |
| Implement multi-stage builds | | ✅ |
| Optimize Docker layer caching | | ✅ |
| Configure container health checks | | ✅ |
| Manage secrets securely | | ✅ |

---

## 📚 Further Reading

- [Docker official docs — Dockerfile reference](https://docs.docker.com/reference/dockerfile/)
- [Docker Compose file reference](https://docs.docker.com/compose/compose-file/)
- [Best practices for writing Dockerfiles](https://docs.docker.com/develop/develop-images/dockerfile_best-practices/)
- [Multi-stage builds](https://docs.docker.com/build/building/multi-stage/)
