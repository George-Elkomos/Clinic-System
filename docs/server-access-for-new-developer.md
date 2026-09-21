# Clinic Server Access — Setup for a New Developer

**Prepared 2026-09-21 for the Clinic System production box.**
An account has already been created for you. It is **waiting for your public key** —
that is the one thing still needed. Everything else below is ready.

---

## 1. Connection details

| | |
|---|---|
| **Host** | `213.199.47.114` — also `clinicms.duckdns.org` |
| **Port** | **22** (default — confirmed) |
| **Username** | **`clinicdev`** — *not* `root` |
| **Authentication** | **SSH public key only** |

### ⚠️ Two things in your notes are incorrect

1. **There is no root password to give you.** The server has
   `PasswordAuthentication no` and `PermitRootLogin without-password` in its
   effective `sshd` config. Password login is impossible for *any* account,
   including root. Asking for "the root password" has no answer — one does not
   exist as a usable credential.
2. **You will not be given `root`.** A dedicated, confined account (`clinicdev`)
   was created for you instead. See §4 for exactly what it can and cannot do.

A private key will also **not** be sent to you. Private keys are never
transmitted — not over chat, not over email, not in a file. You generate your own
keypair and send only the **public** half.

---

## 2. What you need to do — generate a key and send the public half

On **your** machine:

```bash
ssh-keygen -t ed25519 -C "yourname-clinic-dev"
# Press Enter for the default path (~/.ssh/id_ed25519).
# Use a passphrase. It protects the key if your laptop is ever lost.
```

Then print the **public** key and send that one line back:

```bash
cat ~/.ssh/id_ed25519.pub
```

It looks like this — one line, starts with `ssh-ed25519`, ends with your comment:

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... yourname-clinic-dev
```

> ✅ **Send the `.pub` file only.**
> ❌ **Never send `~/.ssh/id_ed25519`** (the file *without* `.pub`). That is the
> private key. If you ever send one by accident, delete the pair and generate a new one.

Once that line arrives it gets appended to `/home/clinicdev/.ssh/authorized_keys`
and you are in. That is a single command — expect it to be quick.

---

## 3. Connecting (once your key is added)

```bash
ssh clinicdev@213.199.47.114
```

Optional — add this to `~/.ssh/config` so you can just type `ssh clinic`:

```
Host clinic
    HostName 213.199.47.114
    User clinicdev
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes
    ServerAliveInterval 60
```

### Verify the host key on your first connection

SSH will show a fingerprint the first time. It **must** be one of these. If it is
not, stop and report it — do not type `yes`.

```
ED25519  SHA256:eeP56YZ2NrsDlYdVpTUC7cLxWOyj9XFaqR0T85ROSwY
ECDSA    SHA256:SBIsP8x3eswIMUC8wGRUCmve771it1lED7FvR1nImoM
RSA      SHA256:KBfmugzkwhFDIYBCEFZUHFPYripkIHqLaXtLZ3x19u0
```

---

## 4. What your account can and cannot do

Scope set by the owner: **full access to the Clinic project, and nothing else.**
This is enforced by the operating system, not by convention — it has been tested.

### ✅ You can

| Action | Notes |
|---|---|
| Read **and write** everything under `/var/www/clinic_app` | Includes `Backend/`, `Frontend/`, and the git repo |
| Run `git` in the repo | `safe.directory` is already configured for you |
| Read `Backend/.env` | Holds `SECRET_KEY` and the PostgreSQL password — treat as secret |
| Run Django | `cd /var/www/clinic_app/Backend && source venv/bin/activate` |
| Connect to the `clinic_system` database | Via the credentials already in `.env` |
| `sudo systemctl start/stop/restart/status clinic-daphne` | Also `clinic-qcluster`. No password prompt |
| `sudo journalctl -u clinic-daphne` | Also `clinic-qcluster` |
| Read `/var/log/clinic_*.log` and `/var/log/clinic-deploy.log` | |

### ❌ You cannot — and should not try

| Blocked | Why |
|---|---|
| Any other project's `.env` or secrets | Verified denied — they are `600 root:root` |
| Writing to any other project | All other project directories are root-owned |
| `/root` (backups, the raw DB password file) | Mode `700` |
| `/var/www/streak_app` | Mode `700` — not even listable |
| `sudo` on nginx, PostgreSQL, cron, or any other project's service | Not in your sudoers rule |
| `sudo bash`, `sudo su`, package installs, user management | No general `ALL` rule exists |

Run `sudo -l` after connecting to see your exact permissions in writing.

> ℹ️ **One deliberate exception:** you *can* read the **source code** of the other
> projects on this box (their directories are world-readable). Their **secrets are
> not** readable. Locking the source down too would mean changing permissions on
> eight live sites that nginx serves files from, which was judged riskier than the
> exposure. Please just stay out of them.

---

## 5. Things you must know before you run anything

### 🔴 This is a live production box with real patient data

The Clinic app serves real appointments at `https://clinicms.duckdns.org`.
It is also a **shared** machine — nine projects run on it (Bible Tools, Bible
Streak with ~70 active students, Sunday School, Follow-up Ministry, Library,
Marriage Registry, Halls, and a staging site). **Never touch shared
infrastructure**: nginx config, the PostgreSQL cluster as a whole, systemd units
that are not `clinic-*`, ports, or the firewall.

### Ask the owner first before

- **Destructive SQL** — `TRUNCATE`, `DROP`, or any `DELETE` without a narrow
  `WHERE`. This applies even inside `clinic_system`.
- **Printing live secrets** into a chat, a log, a ticket, or a transcript.
  `.env` values and the DB password stay on the server.
- Anything that causes downtime.

### The database

PostgreSQL **16.15**, database `clinic_system`, role `clinic_app`, on
`127.0.0.1:5432`. The app was migrated off SQLite on **2026-09-15**.

> ⚠️ `Backend/db.sqlite3` still exists on disk. **It is frozen and dead** — nothing
> reads or writes it. Do not treat it as the live database. Full history is in
> `docs/postgres-production-cutover-runbook-2026-09-15.md` in the repo.

### Deployment is automated — do not deploy by hand

Pushing to `main` on GitHub triggers CI/CD, which SSHes in and runs
`deploy/deploy.sh` (git pull, pip install, frontend build, `migrate`,
`collectstatic`, restart, health check, with automatic rollback on failure).
The deploy job is gated on the test suite passing.

**Do not** run `git pull` or `migrate` by hand on the server to ship a change —
push to `main` and let the pipeline do it. Manual changes on the server make the
working tree dirty and cause the next real deploy to fail.

---

## 6. Read these first

Both are in the repo:

- **`SERVER_INFO.md`** — services, paths, environment variables, nginx layout,
  how deploy and rollback behave.
- **`docs/postgres-production-cutover-runbook-2026-09-15.md`** — the PostgreSQL
  migration and the two bugs it uncovered. Both are now fixed (`306a0d5` for the
  SQLite-only `timeout` connect option, `6da5a2f` for the missing `raw` guards on
  every save-signal receiver), but the runbook explains *why* they existed, which
  is worth knowing before you write a signal receiver or load a fixture here.

---

## 7. Quick orientation once you are in

```bash
sudo -l                                     # your exact permissions
sudo systemctl status clinic-daphne clinic-qcluster
sudo journalctl -u clinic-daphne -n 50

cd /var/www/clinic_app/Backend
source venv/bin/activate
export DJANGO_SETTINGS_MODULE=clinic_project.settings.prod
python manage.py check
python manage.py shell -v 0 -c "from django.db import connection; print(connection.vendor, connection.settings_dict['NAME'])"
```

---

## Summary — the one thing outstanding

**Send back the contents of `~/.ssh/id_ed25519.pub` (one line).** The account,
permissions, sudo rule, and project access are already in place and tested. Your
key is the only missing piece.

*The CI/CD pipeline's `SSH_PRIVATE_KEY` GitHub secret is a separate deploy key and
is not related to your interactive access — you will not need it and should not
ask for it.*
