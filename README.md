# 🔥 Ignis — Group 4

> **Ignis** (Latin: *fire*). The thing Prometheus stole from the gods and handed to humans so they could build.
> We took the AI and built with it. Same energy.

**Repository:** https://github.com/OluwaSeun-Femi/AI-fullstack-grp4

Group 4's shared repository for the Saturday AI full-stack session (17 October 2026).
Every member built an **About me** page with React + Vite, deployed it to Vercel, pushed their code to their own branch here, and added their link to the table below.

## Members

| Name | Role | About me page | Code |
|------|------|---------------|------|
| Oluwaseun Oluwafemi | Captain | _add your link_ | [`OluwaSeun-Femi`](../../tree/OluwaSeun-Femi) |
| Aworeni | Member |(https://deploy-nine-sigma-75.vercel.app/)| _branch link_ |
| Dansu | Member | _add your link_ | _branch link_ |
| Akinsola | Member | _add your link_ | [`Akinsola-Temiloluwa`](../../tree/temi)  |

## How this repo is organised

- **`main`** holds this README only. Nothing else goes here.
- **One branch per person**, named after you (for example `aworeni`). Your branch holds your whole About me project.

## Step 0 — Accept the invitation

Before you can push anything, you need to accept the invite the captain sent you. Do this first; nothing else works until you do.

**Option A — from your email**

1. Open the email inbox you used to sign up for GitHub.
2. Look for an email from **GitHub** with the subject *"OluwaSeun-Femi invited you to OluwaSeun-Femi/AI-fullstack-grp4"*. Check **Spam / Promotions** if you don't see it.
3. Click the green **View invitation** button.
4. Sign in to GitHub if it asks.
5. Click the green **Accept invitation** button.

**Option B — from GitHub directly** (if you can't find the email)

1. Go to https://github.com/OluwaSeun-Femi/AI-fullstack-grp4/invitations
2. Sign in to GitHub if it asks.
3. Click the green **Accept invitation** button.

You can also check https://github.com/notifications — pending invites show up there too.

**How to know it worked:** open https://github.com/OluwaSeun-Femi/AI-fullstack-grp4 and you should see the repo without any "404" or "page not found". Tell the captain **"Invite accepted"** in the group chat.

> Didn't get an invite at all? Send the captain your exact GitHub username (the one in the top-right corner when you're logged in, not your email) so he can add you.

## Step 1 — Push your project to your own branch

You already have your React project on your laptop. Open its folder in the VS Code terminal and run:

```bash
cd about-me

git init                      # skip this line if the folder is already a git repo
git checkout -b yourname      # use your own name, e.g. aworeni
git add .
git commit -m "Add yourname's about-me page"

git remote add origin https://github.com/OluwaSeun-Femi/AI-fullstack-grp4.git
git push -u origin yourname
```

Check: open https://github.com/OluwaSeun-Femi/AI-fullstack-grp4/branches — your branch should be listed.

> `node_modules` and `dist` are already ignored by the `.gitignore` Vite created, so they won't be pushed. Good.

## Step 2 — Add yourself to the Members table

Do this on GitHub in the browser; it's the quickest way and keeps `main` clean.

1. Open https://github.com/OluwaSeun-Femi/AI-fullstack-grp4/blob/main/README.md
2. Click the **pencil icon** (Edit this file) in the top right.
3. Find your row in the **Members** table and fill in your live Vercel link. In the **Code** column, put a link to your branch: `[`yourname`](../../tree/yourname)`.
4. Click **Commit changes…**
5. Choose **Create a new branch for this commit and start a pull request**, name it `add-yourname`, then click **Propose changes**.
6. Click **Create pull request**.

The captain reviews your pull request and merges it. Your name and link then show up on `main`.

<details>
<summary>Prefer the terminal? Same thing from VS Code</summary>

Run this from your project folder (it switches you to a copy of `main`, so your project files will disappear from the folder until you switch back — that's normal):

```bash
git fetch origin main
git checkout -b add-yourname origin/main
# edit README.md: fill in your row
git add README.md
git commit -m "Add yourname"
git push -u origin add-yourname
git checkout yourname          # back to your project
```

Then on GitHub click **Compare & pull request** → **Create pull request**.
</details>

## Quick fixes

| Problem | Fix |
|---------|-----|
| `node` or `npm` is not recognized | Install Node LTS (v20+), then close and reopen VS Code |
| Windows says "running scripts is disabled" | In PowerShell: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| Git asks who you are | `git config --global user.name "Name"` and `git config --global user.email "email"` |
| `remote origin already exists` | Run `git remote set-url origin https://github.com/OluwaSeun-Femi/AI-fullstack-grp4.git` |
| `git push` asks for a password | Sign in to GitHub from VS Code's Source Control panel |
| `git push` says "permission denied" or "403" | You haven't accepted the invite yet — go back to **Step 0** |
| Invite link says "expired" | Invites last 7 days. Ask the captain to send it again |
| "No existing credentials found" (Vercel) | Run `npx vercel login`, then `npx vercel --prod` again |
| Vercel fails completely | Drag your `dist` folder onto https://app.netlify.com/drop |

## Stack

- React 19 + TypeScript
- Vite
- Vercel (hosting)
- Git + GitHub (collaboration)

---

*Made by Ignis · Group 4 · Captain: Oluwaseun Oluwafemi*
