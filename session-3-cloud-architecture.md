# Session 3 — Cloud Architecture (S3 + ECS Lite)

**Duration:** ~3 hours
**Prerequisites:** Completed Sessions 1 & 2 (Docker + EC2), an AWS account with the AWS CLI installed and configured (`aws configure`), the Session 1 backend image building locally

---

## Part 1 — Standard: Core Concepts

### 1.1 Static vs Dynamic Content

So far we've shipped one thing: a backend that runs code on every request. But a real app has two very different kinds of content, and treating them the same is wasteful.

**Static content** — files that are identical for every user and don't change per request:
- HTML, CSS, JavaScript bundles
- Images, fonts, icons
- The compiled output of a React / Vue / Angular build

**Dynamic content** — generated per request, often per user:
- API responses (`/api/orders` for *this* logged-in user)
- Anything that reads/writes a database
- Anything that runs your business logic

| | Static | Dynamic |
|---|---|---|
| Same for every user? | Yes | No |
| Needs a running server? | No — just a file server | Yes — runs code |
| How to scale | Copy the file to many edges (CDN) | Run more containers |
| Cost | Cents (storage + bandwidth) | Dollars (compute time) |
| Example | `index.html`, `app.js` | `GET /health`, `POST /login` |

**Key insight:** you should serve static files from cheap, infinitely-scalable storage, and reserve expensive compute for the dynamic parts. Putting your React build behind a Node server is like hiring a chef to hand out pre-packaged sandwiches.

---

### 1.2 Basic System Architecture

This split gives us the classic two-tier web architecture:

```
                    ┌─────────────────────────────┐
   Browser ────────►│  Static Hosting (S3)        │  index.html, app.js, css
      │             │  → just serves files        │
      │             └─────────────────────────────┘
      │
      │  fetch('/api/...')
      │             ┌─────────────────────────────┐
      └────────────►│  Compute (ECS container)    │  runs your backend code
                    │  → runs code, talks to DB   │
                    └──────────────┬──────────────┘
                                   │
                                   ▼
                            ┌────────────┐
                            │  Database  │
                            └────────────┘
```

- **Frontend → Static hosting:** the browser downloads HTML/JS/CSS once from object storage.
- **Backend → Compute:** the downloaded JS then calls your API for dynamic data.

The two are **decoupled** — you can redeploy the frontend without touching the backend, scale them independently, and even put them on different domains (or the same domain with path routing, covered in Advanced).

---

### 1.3 Object Storage (S3)

**Amazon S3 (Simple Storage Service)** is object storage: you store **objects** (files + metadata) inside **buckets** (top-level containers with globally-unique names). It is not a filesystem and not a disk — there are no folders (the "folders" you see are just key prefixes) and you can't run code there.

| Concept | Meaning |
|---|---|
| **Bucket** | A namespace for your objects. Name is globally unique across all of AWS. |
| **Object** | A file plus metadata, addressed by a **key** (e.g., `assets/app.js`). |
| **Key** | The full path-like name of an object within the bucket. |
| **Region** | Where the bucket physically lives (latency + compliance). |

**Why S3 for a frontend?**
- **Durability:** 99.999999999% ("11 nines") — AWS replicates your objects across hardware automatically.
- **Scalability:** serves 1 request or 1 billion with no servers to manage.
- **Cost:** ~$0.023/GB/month storage. A frontend bundle is a few MB.
- **Static website hosting:** S3 can serve a bucket directly over HTTP as a website.

> **Mental model:** S3 is an infinitely large, infinitely durable hard drive that you talk to over HTTP instead of a SATA cable.

---

### 1.4 Container Orchestration (ECS)

In Session 2 we ran containers by hand: SSH into a VM, `docker compose up`. That works for one server. But what happens when the container crashes at 3am? When you need three copies for traffic? When you want zero-downtime deploys? You'd be SSHing in to babysit it forever.

**Container orchestration** automates the lifecycle of containers: scheduling them onto machines, restarting them when they die, scaling the count up and down, and rolling out new versions.

**Amazon ECS (Elastic Container Service)** is AWS's orchestrator. Its vocabulary:

| Term | Meaning | Analogy |
|---|---|---|
| **Task Definition** | A blueprint: which image, how much CPU/RAM, ports, env vars | A `docker run` recipe / `compose.yaml` for one app |
| **Task** | A running instance of a task definition (1+ containers) | A running container |
| **Service** | Keeps N tasks running, restarts failures, does rolling deploys | `restart: unless-stopped` + a load balancer |
| **Cluster** | A logical group of tasks/services | The "environment" they run in |

**Launch types — who owns the servers?**

```
┌──────────────────────────────────────────────────────────┐
│ ECS on EC2    → you manage the underlying VMs             │
│                 (more control, you patch the hosts)       │
├──────────────────────────────────────────────────────────┤
│ ECS on Fargate→ AWS manages the VMs, you just give a task │
│                 (serverless containers — no host to babysit)│
└──────────────────────────────────────────────────────────┘
```

We'll use **Fargate** for the "lite" deploy: you hand ECS an image and a CPU/RAM size, and it runs the container without you ever touching a server. To run any image, ECS first needs it in a registry — that's **Amazon ECR (Elastic Container Registry)**, AWS's private Docker Hub.

```
local image ──► docker push ──► ECR (registry) ──► ECS Fargate pulls + runs it
```

---

## Part 2 — Standard: Hands-On

Goal: deploy the **frontend to S3** and the **Session 1 backend to ECS Fargate** via ECR.

We'll add a tiny frontend to the project from Session 1:

```
my-app/
├── Dockerfile
├── compose.yaml
├── src/              # backend (Session 1)
└── frontend/
    └── index.html
```

**`frontend/index.html`:**
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Cloud Training</title>
  </head>
  <body>
    <h1>Cloud Training — Frontend on S3</h1>
    <p>Backend health: <span id="status">checking…</span></p>
    <script>
      // Replace with your ECS public IP/URL after Part 2.4
      const API_URL = window.API_URL || "http://localhost:3000";
      fetch(`${API_URL}/health`)
        .then((r) => r.json())
        .then((d) => (document.getElementById("status").textContent = JSON.stringify(d)))
        .catch((e) => (document.getElementById("status").textContent = "error: " + e.message));
    </script>
  </body>
</html>
```

---

### 2.1 Deploy the Frontend to S3

**Step 1 — Create a bucket** (bucket names are globally unique; pick your own suffix):

```bash
# Pick your region once and reuse it
export AWS_REGION=ap-southeast-1
export BUCKET=cloud-training-frontend-<your-initials>-2026

aws s3 mb "s3://$BUCKET" --region "$AWS_REGION"
```

**Step 2 — Enable static website hosting:**

```bash
aws s3 website "s3://$BUCKET/" \
  --index-document index.html \
  --error-document index.html
```

**Step 3 — Allow public reads.** New buckets block all public access by default. For a public website we must lift that block and add a bucket policy.

```bash
# Lift the "block public access" guardrail for this bucket
aws s3api put-public-access-block \
  --bucket "$BUCKET" \
  --public-access-block-configuration \
  "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"
```

Create **`bucket-policy.json`** (replace `BUCKET` with your real name):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::BUCKET/*"
    }
  ]
}
```

```bash
aws s3api put-bucket-policy --bucket "$BUCKET" --policy file://bucket-policy.json
```

**Step 4 — Upload the frontend:**

```bash
aws s3 sync ./frontend "s3://$BUCKET/"
```

**Step 5 — Open the website.** The S3 website endpoint follows a fixed pattern:

```
http://<BUCKET>.s3-website-<REGION>.amazonaws.com
# e.g. http://cloud-training-frontend-ln-2026.s3-website-ap-southeast-1.amazonaws.com
```

```bash
echo "http://$BUCKET.s3-website-$AWS_REGION.amazonaws.com"
```

Open that URL in a browser. You'll see the page; the health check will say `error` for now — we deploy the backend next.

> **Re-deploying the frontend** is just `aws s3 sync ./frontend "s3://$BUCKET/"` again. That's the whole "deploy pipeline" for static content.

---

### 2.2 Push the Backend Image to ECR

ECS can only run images from a registry, so we push the Session 1 image to ECR first.

**Step 1 — Create the repository:**

```bash
aws ecr create-repository \
  --repository-name cloud-training-backend \
  --region "$AWS_REGION"
```

**Step 2 — Authenticate Docker to ECR:**

```bash
# Your 12-digit account ID
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export ECR="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR"
```

**Step 3 — Build, tag, and push.** Fargate runs on `linux/amd64`; if you're on an Apple Silicon Mac you must build for that platform explicitly:

```bash
docker build --platform linux/amd64 -t cloud-training-backend .

docker tag cloud-training-backend:latest "$ECR/cloud-training-backend:latest"

docker push "$ECR/cloud-training-backend:latest"
```

**Step 4 — Confirm it landed:**

```bash
aws ecr list-images --repository-name cloud-training-backend
```

---

### 2.3 Create an ECS Fargate Service (Console)

The CLI for ECS is verbose; the **"Create" wizard in the console is the fastest path** for a first deploy. (Advanced 1 shows the IaC version.)

1. AWS Console → **ECS** → **Clusters** → **Create cluster**.
   - **Name:** `cloud-training`
   - **Infrastructure:** *AWS Fargate (serverless)* → **Create**.
2. **Task definitions** → **Create new task definition**.
   - **Family:** `cloud-training-backend`
   - **Launch type:** Fargate
   - **CPU:** `.25 vCPU`, **Memory:** `0.5 GB` (smallest = cheapest)
   - **Container:**
     - **Name:** `backend`
     - **Image URI:** paste `<ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/cloud-training-backend:latest`
     - **Port mappings:** container port `3000`, protocol TCP
     - **Environment variables:** `NODE_ENV=production`
   - **Create**.
3. Open the cluster → **Services** → **Create**.
   - **Launch type:** Fargate
   - **Task definition:** `cloud-training-backend` (latest revision)
   - **Service name:** `backend`
   - **Desired tasks:** `1`
   - **Networking:**
     - Use the default VPC and subnets
     - **Security group → Create new:** allow inbound **TCP 3000** from `0.0.0.0/0` (testing only)
     - **Public IP:** *Turned on* (so we can reach it without a load balancer)
   - **Create**.

ECS now pulls the image from ECR and starts a task.

---

### 2.4 Test the Deployed Backend

1. Cluster → **Tasks** → click the running task → **Networking** → copy the **Public IP**.

```bash
curl http://<TASK_PUBLIC_IP>:3000/health
# {"status":"ok","env":"production"}
```

2. **Wire the frontend to the backend.** Set `API_URL` in the frontend to the task's public IP, re-upload, and refresh:

```bash
# Quick way: inject the URL via a tiny config the page reads
echo "window.API_URL = 'http://<TASK_PUBLIC_IP>:3000';" > frontend/config.js
```

Add `<script src="config.js"></script>` **before** the inline script in `index.html`, then:

```bash
aws s3 sync ./frontend "s3://$BUCKET/"
```

Refresh the S3 website URL — the health line should now show the live JSON from ECS.

🎉 Frontend on S3, backend on ECS, talking to each other.

> **Note on the changing IP:** a raw Fargate task gets a new public IP every redeploy — fine for a demo, unacceptable for production. The fix is an **Application Load Balancer** (Advanced 2), which gives a stable DNS name in front of the tasks.

---

### 2.5 Useful Commands Reference

```bash
# --- S3 ---
aws s3 ls                                  # list buckets
aws s3 ls "s3://$BUCKET/"                   # list objects
aws s3 sync ./frontend "s3://$BUCKET/"      # deploy frontend
aws s3 rm "s3://$BUCKET/" --recursive       # empty the bucket

# --- ECR ---
aws ecr list-images --repository-name cloud-training-backend
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$ECR"

# --- ECS ---
aws ecs list-clusters
aws ecs list-services --cluster cloud-training
aws ecs list-tasks --cluster cloud-training
aws ecs describe-tasks --cluster cloud-training --tasks <TASK_ARN>

# Tail container logs (if CloudWatch logging is enabled on the task def)
aws logs tail /ecs/cloud-training-backend --follow
```

---

## Part 3 — Practice Exercises

### Exercise 1 — Cache Headers for Static Assets

A browser should never re-download an unchanged `app.js`, but it must always pick up a new `index.html`.

**Requirements:**
1. Re-upload `index.html` with a short cache: `aws s3 cp ./frontend/index.html "s3://$BUCKET/" --cache-control "no-cache"`.
2. Upload hashed assets (CSS/JS) with a long cache: `--cache-control "public, max-age=31536000, immutable"`.
3. Verify the headers come back: `curl -I http://$BUCKET.s3-website-$AWS_REGION.amazonaws.com/index.html` and check the `Cache-Control` header.
4. Explain in one sentence why `index.html` must be `no-cache` while hashed bundles can cache forever.

---

### Exercise 2 — Roll Out a New Backend Version

Practice the deploy loop you'll use forever.

**Tasks:**
1. Add a new field to the `/health` response in `src/index.ts` (e.g., `version: "2"`).
2. Rebuild and push the image to ECR with both `:latest` and a unique tag `:v2`.
3. In ECS, update the task definition's image to `:v2` → create a new revision.
4. Update the service to the new revision and watch the rolling deploy in the console.
5. Confirm `curl .../health` returns the new field — without the URL ever going down (if you have an ALB) or with a brief gap (if using the raw public IP).

---

### Exercise 3 — Lock Down the Bucket Policy

The wide-open `s3:GetObject` policy is fine for a demo but sloppy.

**Tasks:**
1. Confirm what's currently allowed: `aws s3api get-bucket-policy --bucket "$BUCKET"`.
2. Restrict the policy so it only grants `s3:GetObject` (already the case) and nothing else — confirm no `s3:ListBucket` or write actions are public.
3. Try to write to the bucket as an anonymous user (e.g., `curl -X PUT`) and confirm it's denied.
4. Document why "public read" should never imply "public list" or "public write."

---

## Part 4 — Advanced

> Some advanced knowledge is good to know.

---

### Advanced 1 — Front S3 with CloudFront (CDN + HTTPS)

A raw S3 website endpoint is HTTP-only, served from a single region, and exposes the bucket name. **CloudFront** is AWS's CDN: it caches your static files at edge locations worldwide and gives you free HTTPS.

```
Browser ──► CloudFront edge (nearest city) ──► S3 bucket (origin)
              │ caches index.html, app.js
              └ serves over HTTPS, custom domain
```

**Why bother:**
- **HTTPS** for free via AWS Certificate Manager
- **Latency:** files served from the edge nearest the user, not one region
- **Security:** lock the bucket *fully private* and let only CloudFront read it (Origin Access Control), so the S3 URL is no longer public at all

**Sketch:**
1. Create a CloudFront distribution with the S3 bucket as the origin (use the bucket's *REST* endpoint, not the website endpoint, when using OAC).
2. Enable **Origin Access Control** and let the console update the bucket policy so only CloudFront can read.
3. Set the **Default root object** to `index.html`.
4. After deploy, you get a `*.cloudfront.net` URL on HTTPS. Point your custom domain's CNAME at it.

> **Cache invalidation gotcha:** CloudFront caches aggressively. After re-uploading `index.html`, invalidate it: `aws cloudfront create-invalidation --distribution-id <ID> --paths "/index.html"`.

---

### Advanced 2 — Application Load Balancer in Front of ECS

The raw-public-IP approach breaks every redeploy. An **Application Load Balancer (ALB)** gives ECS a stable DNS name, health-checks your tasks, and lets you run more than one.

```
Browser ──► ALB (stable DNS, :443) ──► Target Group ──► ECS Tasks (N copies)
              │ health checks /health         │
              └ removes unhealthy tasks ───────┘
```

**Sketch:**
1. Create an ALB in the same VPC, listener on port `80` (and `443` with an ACM cert for HTTPS).
2. Create a **Target Group** of type *IP* (Fargate uses IP targets), health check path `/health`.
3. In the ECS service, attach the load balancer → container `backend:3000` → the target group.
4. Set **desired tasks** to `2` — the ALB now spreads traffic across both, and a crash on one is invisible to users.
5. Point the frontend's `API_URL` at the ALB's DNS name (no more per-task IPs).

This is the single biggest step from "demo" to "production-shaped."

---

### Advanced 3 — Same-Domain Routing (No CORS)

When the frontend lives on `example.com` and the backend on a different host, the browser enforces **CORS** — you either configure CORS headers on the backend or route both under one domain.

**Path-based routing with one ALB / CloudFront:**

```
example.com/*       ──► S3 (static frontend)
example.com/api/*   ──► ECS backend
```

- **CloudFront** supports multiple **origins** with **behaviors**: `/api/*` → ECS/ALB origin, everything else → S3 origin.
- The browser only ever sees one domain → **no CORS, no preflight, no `API_URL` juggling** (`fetch('/api/health')` just works).

**Challenge:** reconfigure the Part 2 setup so the frontend calls a relative `/api/health` and CloudFront routes `/api/*` to your ALB. Delete the `config.js` IP hack entirely.

---

### Advanced 4 — Push-Button Deploys with the AWS CLI

Clicking the ECS wizard is fine once. For a repeatable deploy, script it. This is the bridge to CI/CD.

**`deploy.sh`:**
```bash
#!/usr/bin/env bash
set -euo pipefail

TAG="$(git rev-parse --short HEAD)"   # tag image by commit
IMAGE="$ECR/cloud-training-backend:$TAG"

# 1. Build + push
docker build --platform linux/amd64 -t "$IMAGE" .
docker push "$IMAGE"

# 2. Register a new task-def revision pointing at the new image
NEW_TASK_DEF=$(aws ecs register-task-definition \
  --cli-input-json "$(sed "s|IMAGE_PLACEHOLDER|$IMAGE|" taskdef.json)" \
  --query 'taskDefinition.taskDefinitionArn' --output text)

# 3. Roll the service to the new revision (ALB does zero-downtime)
aws ecs update-service \
  --cluster cloud-training \
  --service backend \
  --task-definition "$NEW_TASK_DEF"

# 4. Re-deploy the frontend
aws s3 sync ./frontend "s3://$BUCKET/"
echo "Deployed $TAG"
```

**Challenge:** turn this into a **GitHub Actions** workflow triggered on push to `main`, using an IAM role with OIDC (no long-lived AWS keys in CI).

---

### Advanced 5 — IaC for the Whole Stack (Preview)

Like the Terraform preview in Session 2, the entire S3 + ECR + ECS + ALB stack can be declared in code. The community standard for ECS is the [`terraform-aws-modules/ecs`](https://registry.terraform.io/modules/terraform-aws-modules/ecs/aws) module.

```hcl
# What you'd define, conceptually:
# - aws_s3_bucket          (frontend hosting)
# - aws_cloudfront_distribution
# - aws_ecr_repository     (image registry)
# - aws_ecs_cluster        (Fargate)
# - aws_ecs_task_definition
# - aws_ecs_service        (desired_count, ALB attachment)
# - aws_lb / aws_lb_target_group / aws_lb_listener
```

You won't write this on the course, but recognize the trajectory: **console → CLI script → Infrastructure as Code.** Each step trades a little convenience now for a lot of repeatability later.

---

## ✅ Session 3 Outcomes

By the end of this session, you should be able to:

| Skill | Standard | Advanced |
|---|---|---|
| Explain static vs dynamic content and why they split | ✅ | ✅ |
| Describe the frontend-static / backend-compute architecture | ✅ | ✅ |
| Explain what object storage (S3) is and isn't | ✅ | ✅ |
| Host a static frontend on S3 | ✅ | ✅ |
| Explain ECS task / service / cluster and Fargate | ✅ | ✅ |
| Push a Docker image to ECR | ✅ | ✅ |
| Run a container on ECS Fargate and reach it | ✅ | ✅ |
| Manage cache headers for static assets | ✅ | ✅ |
| Front S3 with a CDN (CloudFront) + HTTPS | | ✅ |
| Put an ALB in front of ECS for stable, multi-task serving | | ✅ |
| Route frontend + backend under one domain (no CORS) | | ✅ |
| Script a repeatable deploy | | ✅ |

---

## 🧹 Cleanup (Important!)

S3, ECR, and ECS all bill for idle resources. When you finish:

```bash
# Stop paying for the running container: set service to 0 tasks, then delete
aws ecs update-service --cluster cloud-training --service backend --desired-count 0
aws ecs delete-service --cluster cloud-training --service backend --force
aws ecs delete-cluster --cluster cloud-training

# Empty + delete the S3 bucket
aws s3 rm "s3://$BUCKET/" --recursive
aws s3 rb "s3://$BUCKET"

# Delete ECR images + repo
aws ecr delete-repository --repository-name cloud-training-backend --force
```

Also delete any **ALB**, **CloudFront distribution**, and **Elastic IPs** you created in Part 4 — load balancers and idle distributions cost real money.

---

## 📚 Further Reading

- [Amazon S3 — Static website hosting](https://docs.aws.amazon.com/AmazonS3/latest/userguide/WebsiteHosting.html)
- [Amazon ECR — Getting started](https://docs.aws.amazon.com/AmazonECR/latest/userguide/getting-started-cli.html)
- [Amazon ECS on Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html)
- [Deploy a container to ECS — AWS tutorial](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/getting-started-fargate.html)
- [Amazon CloudFront — Serving static content from S3](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/getting-started-cloudfront-overview.html)
- [Application Load Balancer with ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-load-balancing.html)
