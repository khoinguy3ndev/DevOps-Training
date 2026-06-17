# Session 2 — VM (EC2) & Infrastructure

**Duration:** ~3 hours
**Prerequisites:** Completed Session 1 (Docker basics), an AWS account (Free Tier is enough), basic terminal usage

---

## Part 1 — Standard: Core Concepts

### 1.1 What is Cloud?

In Session 1 we ran everything on our laptop. That works for development, but not for users on the internet — your laptop is offline at night, has a dynamic IP, and isn't built to serve traffic 24/7.

**Cloud computing** is renting computing resources (servers, storage, network) from a provider over the internet, on-demand, and paying only for what you use.

| | Traditional (On-Premise) | Cloud |
|---|---|---|
| Hardware | You buy and maintain | Provider owns |
| Setup time | Weeks (order → rack → install) | Seconds (API call) |
| Scaling | Buy more hardware | Click a button |
| Cost model | CapEx (big upfront) | OpEx (pay-as-you-go) |
| Risk | You handle failures | Provider handles infra |

Major providers: **AWS**, **Google Cloud (GCP)**, **Microsoft Azure**. We'll use AWS in this course because it has the largest market share and the most generous Free Tier for learning.

---

### 1.2 What is IaaS (Infrastructure as a Service)?

Cloud services are usually grouped into three layers based on **how much the provider manages for you**:

```
┌────────────────────────────────────────────────┐
│ SaaS  (Software as a Service)                  │  Gmail, Notion, Figma
│       → You just use the app                   │
├────────────────────────────────────────────────┤
│ PaaS  (Platform as a Service)                  │  Vercel, Railway, Heroku
│       → You push code, provider runs it        │
├────────────────────────────────────────────────┤
│ IaaS  (Infrastructure as a Service)            │  AWS EC2, GCP Compute
│       → You get a raw VM, manage everything    │
└────────────────────────────────────────────────┘
```

**IaaS** gives you the lowest-level building block: a virtual machine you can SSH into and treat like a Linux server. You install your own OS packages, set up your own runtime, configure your own networking.

- **Pros:** maximum control, can run anything, predictable cost
- **Cons:** you are responsible for security patches, monitoring, scaling, backups

We'll cover PaaS in Session 4. For now: **IaaS = a VM in the cloud**.

---

### 1.3 How a Virtual Machine Works

A **Virtual Machine (VM)** is a software-emulated computer running on top of a physical server. The physical server runs a **hypervisor** that slices its CPU, RAM, disk, and network into multiple isolated VMs.

```
┌─────────────────────────────────────────────────┐
│              Physical Server                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │  VM 1    │  │  VM 2    │  │  VM 3    │      │
│  │ Ubuntu   │  │ Amazon   │  │ Windows  │      │
│  │ 22.04    │  │ Linux    │  │ Server   │      │
│  └──────────┘  └──────────┘  └──────────┘      │
│             Hypervisor (KVM, Xen)               │
│             Host OS                             │
│             CPU / RAM / Disk / NIC              │
└─────────────────────────────────────────────────┘
```

On AWS, a VM is called an **EC2 instance** (Elastic Compute Cloud). Each instance has:

| Property | Example |
|---|---|
| **Instance type** | `t3.micro` (2 vCPU, 1 GiB RAM) |
| **AMI** | Amazon Machine Image — the OS template (e.g., Ubuntu 24.04) |
| **Storage (EBS)** | Virtual disk, e.g., 8 GB SSD |
| **Public IP** | Assigned for internet access |
| **Key pair** | SSH key used to log in |
| **Security Group** | Firewall rules (which ports are open) |

**VM vs Container (recap from Session 1):**
A VM emulates a full machine with its own kernel; a container shares the host kernel. In production you typically **run containers inside a VM** — the VM gives you isolation from other tenants on the physical server, and containers give you isolation between your own apps.

---

### 1.4 Basic Networking (IP, Port, Firewall)

Before deploying, you need a minimum mental model of how traffic reaches your server.

**IP address** — the unique address of a machine on a network.
- **Public IP**: reachable from the internet (e.g., `54.169.23.10`)
- **Private IP**: only reachable inside the cloud's internal network (e.g., `172.31.0.5`)

**Port** — a numbered channel on a machine. One IP can run many services, each on a different port.

| Port | Service |
|---|---|
| 22 | SSH |
| 80 | HTTP |
| 443 | HTTPS |
| 3000 | Our Node.js app (from Session 1) |
| 5432 | Postgres |
| 6379 | Redis |

A full address looks like: `54.169.23.10:3000` → "port 3000 on this machine".

**Security Group (firewall)** — by default an EC2 instance blocks all inbound traffic. You must explicitly allow:
- Port `22` from **your IP** (so you can SSH in)
- Port `80` / `443` from `0.0.0.0/0` (so the world can reach your app)

> **Rule of thumb:** Never open port 22 to `0.0.0.0/0`. Bots scan the entire internet for open SSH ports every minute.

```
Internet ──► [Security Group: allow 80, 443] ──► EC2 instance ──► Docker ──► your app
                  ▲
                  └── allow 22 only from your laptop's IP
```

---

## Part 2 — Standard: Hands-On

Goal: take the Docker Compose stack from Session 1 and run it on a real cloud VM, reachable from the internet.

### 2.1 Create an EC2 Instance

1. Log in to the [AWS Console](https://console.aws.amazon.com/) → search **EC2** → **Launch instance**.
2. Fill in:
   - **Name:** `training-session-2`
   - **AMI:** *Ubuntu Server 24.04 LTS* (Free Tier eligible)
   - **Instance type:** `t3.micro` (Free Tier eligible)
   - **Key pair:** click *Create new key pair* → name it `training-key` → type `RSA`, format `.pem` → download the file. **Save it carefully — AWS will not show it again.**
   - **Network settings → Edit:**
     - Allow SSH from **My IP** (not Anywhere)
     - Allow HTTP from Anywhere (`0.0.0.0/0`)
     - Allow HTTPS from Anywhere (`0.0.0.0/0`)
   - **Storage:** 8 GB gp3 (default is fine)
3. Click **Launch instance**.

After ~30 seconds, the instance shows state `Running`. Copy the **Public IPv4 address** — you'll need it.

---

### 2.2 SSH Into the Server

The `.pem` file you downloaded is your private key. SSH refuses keys with loose permissions.

```bash
# One-time: tighten the key file permissions
chmod 400 ~/Downloads/training-key.pem

# Connect (replace <PUBLIC_IP> with your instance's IP)
ssh -i ~/Downloads/training-key.pem ubuntu@<PUBLIC_IP>
```

First connection will ask you to verify the host fingerprint — type `yes`.

You should now be at a prompt like `ubuntu@ip-172-31-x-x:~$`. You are inside the VM.

```bash
# Sanity checks
whoami        # → ubuntu
uname -a      # → Linux ip-... 6.x ... x86_64 GNU/Linux
df -h         # → ~8 GB disk
free -h       # → ~1 GB RAM
```

---

### 2.3 Install Docker on the VM

Ubuntu's default repos ship an older Docker. Use Docker's official repo to get the current version with Compose v2 built in.

```bash
# Update package index
sudo apt-get update

# Install prerequisites
sudo apt-get install -y ca-certificates curl gnupg

# Add Docker's official GPG key
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# Add the repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine + Compose plugin
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin

# Let the ubuntu user run docker without sudo
sudo usermod -aG docker ubuntu

# Re-login to apply group change
exit
ssh -i ~/Downloads/training-key.pem ubuntu@<PUBLIC_IP>

# Verify
docker --version
docker compose version
docker run --rm hello-world
```

---

### 2.4 Run Docker Compose on the VM

You have two options to get the Session 1 code onto the VM. Pick one.

**Option A — Clone from Git (recommended):**
```bash
git clone https://github.com/<your-user>/<your-repo>.git my-app
cd my-app
```

**Option B — Copy from your laptop with `scp`:**
```bash
# Run this on your LAPTOP, not the VM
scp -i ~/Downloads/training-key.pem -r ./my-app \
  ubuntu@<PUBLIC_IP>:/home/ubuntu/my-app
```

Then back on the VM:
```bash
cd ~/my-app
docker compose up -d --build
docker compose ps
docker compose logs -f app
```

**Open port 3000 in the Security Group** (temporarily, for testing):
- AWS Console → EC2 → your instance → **Security** tab → click the security group
- **Edit inbound rules** → Add rule: Custom TCP, port `3000`, source `My IP`
- Save

Now from your laptop:
```bash
curl http://<PUBLIC_IP>:3000/health
# {"status":"ok","env":"development"}
```

🎉 Your app is on the internet.

---

### 2.5 Useful VM Commands Reference

```bash
# See processes and resource usage
htop                 # press q to quit (install with: sudo apt install -y htop)
top
df -h                # disk usage
free -h              # memory usage

# Check what's listening on which port
sudo ss -tulpn

# View system logs
journalctl -u docker --since "10 min ago"

# Copy files between laptop and VM
scp -i key.pem file.txt ubuntu@<IP>:/home/ubuntu/
scp -i key.pem ubuntu@<IP>:/home/ubuntu/file.txt ./

# Run a command on the VM without an interactive shell
ssh -i key.pem ubuntu@<IP> "docker compose ps"
```

---

## Part 3 — Practice Exercises

### Exercise 1 — Put Nginx in Front of the App

Reuse the Nginx reverse proxy from Session 1 Exercise 1, but this time on the EC2 instance.

**Requirements:**
1. Update `compose.yaml` on the VM so nginx listens on host port `80` and proxies to the `app` service internally.
2. Remove the host binding for port `3000` — only nginx should be exposed.
3. Remove the temporary port `3000` rule you added to the Security Group.
4. Verify from your laptop: `curl http://<PUBLIC_IP>/health` returns the expected JSON.
5. Verify port 3000 is no longer reachable: `curl http://<PUBLIC_IP>:3000/health` should time out.

---

### Exercise 2 — Survive a Reboot

A real server gets restarted (kernel updates, hardware migration). Your app should come back up automatically.

**Tasks:**
1. Add `restart: unless-stopped` to every service in `compose.yaml`.
2. Reboot the VM: `sudo reboot` (your SSH session will drop).
3. Wait ~30 seconds, SSH back in.
4. Run `docker compose ps` — without doing anything else, all services should be `Up`.
5. Run `curl http://localhost/health` on the VM. It should work.

---

### Exercise 3 — Lock Down SSH

1. In the Security Group, confirm port 22 is restricted to **My IP** only (not `0.0.0.0/0`).
2. From the VM, run `sudo tail -f /var/log/auth.log` for one minute. If port 22 is open to the world, you'll see brute-force attempts immediately. If it's locked down, the log stays quiet.
3. Document in a `DEPLOY.md` file how a new teammate would get SSH access (add their IP to the Security Group, share the key via a secret manager — never email or Slack).

---

## Part 4 — Advanced

> Some advanced knowledge is good to know.

---

### Advanced 1 — Use a Domain Name + HTTPS with Caddy

Raw IP addresses are unprofessional and HTTP is insecure. With one extra container, you can have a real domain on HTTPS.

**Prerequisites:**
- A domain you own (e.g., from Cloudflare, Namecheap)
- An `A` record pointing `app.example.com` → `<PUBLIC_IP>`
- Ports `80` and `443` open in the Security Group

**Replace nginx with Caddy in `compose.yaml`:**
```yaml
services:
  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - app
    restart: unless-stopped

  app:
    build: .
    expose:
      - "3000"
    # ... rest unchanged

volumes:
  caddy_data:
  caddy_config:
```

**`Caddyfile`:**
```
app.example.com {
  reverse_proxy app:3000
}
```

Caddy automatically obtains and renews a Let's Encrypt certificate. After `docker compose up -d`, visit `https://app.example.com` — you get HTTPS with zero config.

---

### Advanced 2 — Elastic IP & Why Public IPs Change

By default, an EC2 instance's public IP is **released on stop and reassigned on start**. Reboot doesn't change it; full stop/start does. This breaks DNS records.

**Solution: Elastic IP (EIP)** — a static public IP you own and attach to an instance.

```
EC2 Console → Elastic IPs → Allocate Elastic IP address
            → Actions → Associate → choose your instance
```

**Cost note:** an attached EIP is free; an *unattached* EIP costs ~$3.60/month. AWS charges for waste, not use. Release EIPs you're not using.

---

### Advanced 3 — Cost & Free Tier Hygiene

The Free Tier covers a lot, but unattended resources cost real money. Set guardrails on day one.

**Set a billing alert:**
1. AWS Console → Billing → **Budgets** → Create budget
2. Type: *Cost budget*, amount: `$5/month`
3. Alert at 80% and 100% to your email

**Daily cleanup checklist:**
```bash
# What's running?
aws ec2 describe-instances \
  --query "Reservations[].Instances[].[InstanceId,State.Name,InstanceType]" \
  --output table

# Volumes not attached to anything?
aws ec2 describe-volumes --filters Name=status,Values=available

# Unattached Elastic IPs?
aws ec2 describe-addresses \
  --query "Addresses[?AssociationId==null]" 
```

**Rule:** if you stop using this tutorial, **terminate the instance** (not just stop). Stopped instances are free for compute, but the attached EBS volume keeps charging.

---

### Advanced 4 — Logs, Updates, and Backups

A real server needs at least the minimum of operational hygiene.

**Centralize container logs:**
```bash
# Rotate Docker logs so disk doesn't fill up
sudo tee /etc/docker/daemon.json > /dev/null <<EOF
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF
sudo systemctl restart docker
```

**Unattended security updates:**
```bash
sudo apt-get install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

**Snapshot the EBS volume (backup):**
```
EC2 Console → Volumes → select your volume → Actions → Create snapshot
```
Snapshots are point-in-time backups. Restore by creating a new volume from a snapshot and attaching it to an instance.

**Challenge:** schedule a daily snapshot using **Amazon Data Lifecycle Manager** — no code required, just a policy in the console.

---

### Advanced 5 — Infrastructure as Code (Preview)

Clicking through the AWS Console is fine for learning, painful for real teams: nobody remembers what they clicked, and you can't review changes in a PR.

**The fix:** define infrastructure in code.

```hcl
# main.tf — minimal Terraform example
provider "aws" {
  region = "ap-southeast-1"
}

# Look up the latest Ubuntu 24.04 AMI instead of hardcoding the ID
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]  # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }
}

resource "aws_instance" "training" {
  ami           = data.aws_ami.ubuntu.id
  instance_type = "t3.micro"
  key_name      = "training-key"

  tags = {
    Name = "training-session-2"
  }
}
```

```bash
terraform init
terraform plan      # preview changes
terraform apply     # create the instance
terraform destroy   # tear it all down
```

You won't use Terraform on this course, but recognize the pattern: **clicks are good for learning, code is good for production.**

---

## ✅ Session 2 Outcomes

By the end of this session, you should be able to:

| Skill | Standard | Advanced |
|---|---|---|
| Explain Cloud, IaaS, and what a VM is | ✅ | ✅ |
| Reason about IPs, ports, and security groups | ✅ | ✅ |
| Launch an EC2 instance with sensible defaults | ✅ | ✅ |
| SSH into a server with a key pair | ✅ | ✅ |
| Install Docker on Ubuntu | ✅ | ✅ |
| Deploy a Docker Compose stack to a public VM | ✅ | ✅ |
| Front the app with Nginx / Caddy | ✅ | ✅ |
| Use a custom domain with automatic HTTPS | | ✅ |
| Manage costs with budgets and Elastic IPs | | ✅ |
| Apply basic operational hygiene (logs, updates, backups) | | ✅ |
| Recognize the value of Infrastructure as Code | | ✅ |

---

## 🧹 Cleanup (Important!)

When you finish the session, either:
- **Stop** the instance (keeps EBS, no compute charge) — pick this if you'll continue tomorrow
- **Terminate** the instance (deletes everything) — pick this if you're done

Also release any **unassociated Elastic IPs** to avoid the $3.60/month idle charge.

---

## 📚 Further Reading

- [AWS EC2 — Getting started](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/EC2_GetStarted.html)
- [AWS Free Tier limits](https://aws.amazon.com/free/)
- [Docker install on Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
- [SSH essentials — DigitalOcean](https://www.digitalocean.com/community/tutorials/ssh-essentials-working-with-ssh-servers-clients-and-keys)
- [Caddy — Automatic HTTPS](https://caddyserver.com/docs/automatic-https)
- [Terraform — Get started on AWS](https://developer.hashicorp.com/terraform/tutorials/aws-get-started)
