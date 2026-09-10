# Deploying RADR. to AWS EC2 with Docker

This guide assumes you have never used AWS, Docker or a Linux server. Follow it top to bottom once; afterwards a new release is a single command (Part 9).

## What you will end up with

```
Browser ──HTTPS──▶ EC2 instance (Ubuntu, one small virtual machine)
                    ├── caddy  container : ports 80/443, gets the TLS certificate for you
                    └── app    container : the Next.js server on port 3000 (internal only)
                                └── /data volume : radar.db (SQLite) survives restarts and rebuilds
```

Everything lives in this repository:

| File | Purpose |
|---|---|
| `Dockerfile` | Builds the app image (Node 20, Next.js standalone output). |
| `docker-compose.yml` | Runs the two containers and the data volume. |
| `deploy/Caddyfile` | Reverse proxy and automatic HTTPS. |
| `deploy/entrypoint.sh` | Applies database migrations, then starts the server. |
| `deploy/ec2-user-data.sh` | One-time server setup, pasted into the AWS launch form. |
| `deploy/update.sh` | Pull the latest code and restart. |
| `deploy/backup.sh` | Consistent copy of the database. |
| `deploy/invite.sh` | Allow a Google account to sign in. |
| `.env.production.example` | Template for the server's `.env`. |

Rough cost: a `t3.small` instance is about USD 15 to 17 per month plus a few dollars for the disk and the static IP.

---

## Part 1. Things to have ready

1. **An AWS account** with a payment method. Sign in at https://console.aws.amazon.com.
2. **A hostname**, for example `radr.houseofedtech.in`. You need access to wherever the domain's DNS records are managed (GoDaddy, Cloudflare, Route 53, and so on). Google sign-in does not work against a bare IP address, so this is required, not optional.
3. **A Google Cloud project** for the OAuth client (Part 6).
4. **A DeepSeek API key** from https://platform.deepseek.com.
5. **This code on GitHub**, including the deployment files. The server downloads the code from GitHub, so commit and push first:

   ```bash
   git add -A
   git commit -m "Landing page and Docker deployment"
   git push origin main
   ```

   If the repository is private, also create a fine-grained personal access token with read access to it at https://github.com/settings/tokens. You will paste it into the clone command in Part 5.

---

## Part 2. Create the server (EC2 instance)

1. In the AWS console, pick a **region** in the top-right corner. Choose the one closest to your users, for example `Asia Pacific (Mumbai) ap-south-1`. Stay in this region for every step.
2. Search for **EC2** and open it. Click **Launch instance**.
3. Fill the form:
   - **Name**: `radar`
   - **Application and OS Images**: choose **Ubuntu**, then **Ubuntu Server 24.04 LTS**, architecture **64-bit (x86)**.
   - **Instance type**: `t3.small` (2 vCPU, 2 GB). `t3.micro` is too small to build the app.
   - **Key pair**: click **Create new key pair**. Name it `radar-key`, type **RSA**, format **.pem**. Click **Create**; a file `radar-key.pem` downloads. Keep it safe, it is the only way to log in.
   - **Network settings**: click **Edit**.
     - Auto-assign public IP: **Enable**.
     - Firewall: **Create security group**, name `radar-web`.
     - Rules (click **Add security group rule** for each):
       | Type | Port | Source |
       |---|---|---|
       | SSH | 22 | **My IP** |
       | HTTP | 80 | Anywhere (0.0.0.0/0) |
       | HTTPS | 443 | Anywhere (0.0.0.0/0) |
   - **Configure storage**: `20` GiB, **gp3**.
   - **Advanced details** (expand it, scroll to the bottom): in **User data**, paste the entire contents of `deploy/ec2-user-data.sh`. This installs Docker automatically on first boot.
4. Click **Launch instance**, then **View all instances**. Wait until **Instance state** says *Running* and **Status check** says *2/2 checks passed* (two or three minutes).

### Give it a permanent IP address

Without this step the IP changes every time the instance stops.

1. In the EC2 left menu, under **Network & Security**, click **Elastic IPs**.
2. **Allocate Elastic IP address** → **Allocate**.
3. Select the new address → **Actions** → **Associate Elastic IP address** → choose the `radar` instance → **Associate**.
4. Write down this IP address. It is referred to as `YOUR_IP` below.

---

## Part 3. Point your hostname at the server

At your DNS provider, add one record:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `radr` (for `radr.houseofedtech.in`) | `YOUR_IP` | 300 |

Check it has propagated (can take from a minute to an hour):

```bash
nslookup radr.houseofedtech.in
```

The answer should show `YOUR_IP`. Do not continue to Part 7 until it does, because the certificate request will fail otherwise.

---

## Part 4. Connect to the server

On your Mac, open Terminal.

```bash
# Move the key somewhere sensible and lock down its permissions (SSH refuses loose keys).
mkdir -p ~/.ssh
mv ~/Downloads/radar-key.pem ~/.ssh/radar-key.pem
chmod 400 ~/.ssh/radar-key.pem

# Log in. Type "yes" when asked about the fingerprint.
ssh -i ~/.ssh/radar-key.pem ubuntu@YOUR_IP
```

You are now typing commands on the server. Confirm the automatic setup finished:

```bash
cat /var/log/radar-bootstrap.done
docker --version
docker compose version
```

If the first command says *No such file*, the setup script is still running. Wait a minute and try again. If `docker` says *permission denied*, log out (`exit`) and back in once; group membership only applies to new logins.

---

## Part 5. Get the code onto the server

```bash
cd ~
git clone https://github.com/Spore301/Radar.git radar
cd radar
```

For a private repository use the token from Part 1 instead:

```bash
git clone https://YOUR_GITHUB_USERNAME:YOUR_TOKEN@github.com/Spore301/Radar.git radar
```

---

## Part 6. Create the Google sign-in client

1. Go to https://console.cloud.google.com and create a project (or pick an existing one).
2. **APIs & Services → OAuth consent screen**. Choose **Internal** if your organisation uses Google Workspace and only your staff should sign in; otherwise **External**. Fill the app name (`RADR.`) and support email. Save.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   - Application type: **Web application**
   - Name: `RADR production`
   - **Authorised JavaScript origins**: `https://radr.houseofedtech.in`
   - **Authorised redirect URIs**: `https://radr.houseofedtech.in/api/auth/callback/google`
4. Click **Create**. Copy the **Client ID** and **Client secret**; they go into `.env` next.

---

## Part 7. Configure and start

Still on the server, inside `~/radar`:

```bash
cp .env.production.example .env
openssl rand -base64 32     # copy the output, it becomes AUTH_SECRET
nano .env
```

Fill in every line:

| Variable | What to put |
|---|---|
| `SITE_ADDRESS` | Your hostname, e.g. `radr.houseofedtech.in` (no `https://`). |
| `AUTH_SECRET` | The random string from `openssl rand -base64 32`. |
| `AUTH_TRUST_HOST` | `true` |
| `AUTH_GOOGLE_ID` | Client ID from Part 6. |
| `AUTH_GOOGLE_SECRET` | Client secret from Part 6. |
| `ALLOWED_GOOGLE_DOMAIN` | Your Workspace domain, e.g. `houseofedtech.in`, so every colleague can sign in. Leave empty to allow only invited emails (Part 8). |
| `DEEPSEEK_API_KEY` | Your DeepSeek key. |
| `SERPAPI_KEY` | Optional. Recruiters add their own key during onboarding. |

In `nano`: arrow keys to move, type to edit, `Ctrl+O` then `Enter` to save, `Ctrl+X` to exit.

Now build and start. The first build takes five to ten minutes on a `t3.small`.

```bash
docker compose up -d --build
docker compose logs -f app
```

Wait for these two lines, then press `Ctrl+C` to stop following the log (the app keeps running):

```
[radar] applying database migrations to file:/data/radar.db
[radar] starting Next.js on port 3000
```

Check from your Mac:

```bash
curl https://radr.houseofedtech.in/api/health
```

Expected: `{"ok":true,"db":"up",...}`. Then open `https://radr.houseofedtech.in` in a browser: the landing page appears with a valid padlock. Caddy fetched the certificate in the background the first time the hostname was requested.

---

## Part 8. Let people in

If you set `ALLOWED_GOOGLE_DOMAIN`, anyone with a Google account on that domain can already sign in. Everyone else needs an invite:

```bash
~/radar/deploy/invite.sh person@example.com
```

Sign in, complete onboarding (name, company, SerpAPI key), and run a first search.

---

## Part 9. Releasing a new version

After pushing new commits to GitHub:

```bash
ssh -i ~/.ssh/radar-key.pem ubuntu@YOUR_IP
~/radar/deploy/update.sh
```

This pulls the code, rebuilds the image, applies any new database migrations and restarts the app. Downtime is the few seconds the container takes to start. Data on the volume is untouched.

---

## Part 10. Backups

```bash
~/radar/deploy/backup.sh          # writes ~/radar/backups/radar-<date>.db
```

Copy backups off the server from your Mac:

```bash
scp -i ~/.ssh/radar-key.pem ubuntu@YOUR_IP:~/radar/backups/*.db ~/Desktop/
```

For automatic nightly backups, on the server run `crontab -e` and add:

```
15 2 * * * /home/ubuntu/radar/deploy/backup.sh >> /home/ubuntu/radar/backups/backup.log 2>&1
```

---

## Everyday commands (run on the server, in ~/radar)

| What | Command |
|---|---|
| Is it running? | `docker compose ps` |
| App log | `docker compose logs -f app` |
| Proxy / certificate log | `docker compose logs -f caddy` |
| Restart | `docker compose restart app` |
| Stop everything (keeps data) | `docker compose down` |
| Start again | `docker compose up -d` |
| Change a setting | edit `.env`, then `docker compose up -d` |
| Disk usage | `df -h` and `docker system df` |

---

## When something goes wrong

**The site shows a browser certificate warning or "connection refused".**
DNS is not pointing at the server yet, or ports 80/443 are not open. Check `nslookup your-hostname` shows `YOUR_IP`, check the security group has HTTP and HTTPS rules, then `docker compose logs caddy` for the certificate attempt.

**`502 Bad Gateway`.**
Caddy is up but the app is not. `docker compose logs app` shows why. Typical cause: a missing `.env` value.

**Google sign-in says `redirect_uri_mismatch`.**
The redirect URI in Google Cloud must be exactly `https://<SITE_ADDRESS>/api/auth/callback/google`.

**Signing in works but says the account is not authorised.**
The email is not on `ALLOWED_GOOGLE_DOMAIN` and has no invite. Use `deploy/invite.sh`.

**The build is killed or the server freezes during `docker compose up --build`.**
Out of memory. Confirm swap is on with `free -h` (should show 2 GB swap). If not, re-run the swap section of `deploy/ec2-user-data.sh` as root, or resize to `t3.medium` (Instance → Stop → Actions → Instance settings → Change instance type).

**`permission denied while trying to connect to the Docker daemon`.**
Log out and back in so the `docker` group applies.

**You lost the `.pem` key.**
There is no recovery for that key. Create a new instance with a new key pair and restore from a backup.

---

## Security notes

- The `.env` file holds secrets. It is ignored by git and only exists on the server. Do not paste it into chat or tickets.
- SSH is restricted to your IP. If your home IP changes, edit the security group's SSH rule to the new address.
- Ubuntu installs security updates automatically. Reboot occasionally (`sudo reboot`); the containers restart on their own.
- Keep the AWS root account for billing only; day-to-day, create an IAM user with the `AdministratorAccess` policy and sign in with that.
