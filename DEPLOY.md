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

## Part 11. Cap your spending and stop the instance automatically

AWS has no true hard spending limit, but it can watch your spend and stop the instance when a threshold is crossed. That is close enough, with one caveat: billing data refreshes roughly every eight hours, so the stop happens within that window rather than instantly. Budget your cap a little below what you can afford.

### What the instance costs

Based on `t2.small` in Singapore at $0.0292 per hour:

| Item | Per month |
|---|---|
| Instance compute, running continuously | $21.30 |
| Public IPv4 address | $3.65 |
| 20 GiB gp3 disk | about $2.40 |
| Total | about $27 |

A $50 cap is therefore about eight weeks of continuous running.

### Create the budget

You need the instance to exist first, because the action targets it by ID.

1. In the top search bar type **Billing** and open **Billing and Cost Management**.
2. In the left menu click **Budgets**, then **Create budget**.
3. Choose **Customize (advanced)**, then **Cost budget**, then **Next**.
4. Under **Set budget amount**:
   - Period: **Annually**
   - Budget renewal type: **Expiring budget**
   - Start date: today. End date: twelve months from now.
   - Enter budgeted amount: `50`

   An expiring annual budget is one single pot of $50 rather than $50 every month, which is what a total cap means.
5. Budget scope: leave it on **All AWS services**. This is deliberate. It catches the disk, the IP address and data transfer as well as the instance, so nothing slips past the cap.
6. Expand **Advanced options** and make sure **Credits** is **not** included in the calculation. This matters. If credits are included, the budget measures what you owe after credits are applied, which stays near zero and never triggers. Excluding them makes the budget measure the credit you are actually burning.
7. Click **Next**.

### Add warning emails

On the alerts page, click **Add alert threshold** twice and set up two:

| Threshold | Purpose |
|---|---|
| 50% of budgeted amount | Early warning, about four weeks in |
| 80% of budgeted amount | Time to decide, about six weeks in |

Put your email address in the recipients box for both. Click **Next**.

### Attach the stop action

This is the part that actually shuts things down.

1. Click **Add action**.
2. Threshold: **100% of budgeted amount**.
3. IAM role: AWS needs permission to stop your instance on your behalf. If no role is offered, create one and attach the managed policy named `AWSBudgetsActionsWithAWSResourceControlAccess`. The console usually offers to create it for you.
4. Action type: **EC2 instances**.
5. Select your `Radr` instance from the list.
6. Approval: choose **Automatically execute action**. If you pick the approval option instead, AWS only emails you and waits, which defeats the purpose.
7. Click **Next**, review the summary, then **Create budget**.

Console wording shifts between AWS releases. If a label differs, the intent above is what to match.

### What stopping does and does not stop

A stopped instance costs nothing for compute, which is the large part of the bill. Two smaller charges continue:

- The 20 GiB disk, about $2.40 a month, because your database lives on it.
- The Elastic IP address, about $3.65 a month.

So a stopped instance still costs roughly $6 a month. That is deliberate: your data and your address survive, and starting it again is one click. To reduce the bill to exactly zero you must **terminate** the instance and **release** the Elastic IP, which destroys the server and the database with it. Take a backup first, per Part 10.

### Two ways to stretch the credit further

- **Stop it outside working hours.** This is an internal tool. If it only needs to be up during the day, stopping it nightly and at weekends cuts compute by roughly two thirds, turning eight weeks into six months. Start and stop from the EC2 console, or schedule it later with EC2 Instance Scheduler.
- **Shrink the instance after the first build.** Building the image needs about 2 GB of memory, but serving the app needs a few hundred megabytes. Once the image is built you can resize to `t3.micro`, which is free for the first twelve months on a new account. Rebuilds then need a temporary resize back up. Stop the instance, use **Actions**, **Instance settings**, **Change instance type**, then start it again.

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
