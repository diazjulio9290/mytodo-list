# Productive Day Timer

Neon-backed task planner with a small Express API.

## Local development

1. Copy `.env.example` to `.env`.
2. Set `DATABASE_URL` to your Neon connection string.
3. Set `SESSION_SECRET` to a long random string.
4. Run:

```sh
npm install
npm start
```

The app runs at `http://localhost:3000`.

## Deploy to Vercel

1. Push this repo to GitHub.
2. In Vercel, import `diazjulio9290/mytodo-list`.
3. Add these environment variables in the Vercel project settings:

```txt
DATABASE_URL=postgresql://...
SESSION_SECRET=replace-this-with-a-long-random-string
```

4. Deploy.

GitHub Pages can only host the old static version. This Neon version needs Vercel or another Node-capable host because the database password must stay on the server.

## How a day works

**Build the list, then press Start.** A task you add as "Next in line" joins the list but does not count down. Press **Start now** in the top band when you are ready, or **Start at a set time** to have the list begin later. New tasks also wait for Start whenever nothing is running or coming up, for example when you plan an afternoon block after the morning one ended.

**Next in line or at a set time.** Each task has a "Starts" choice:

- *Next in line* starts when the task before it ends.
- *At a set time* starts at the time you pick, and the tasks after it follow on. It is slotted into the list in time order. A task that would still be running at that time is moved to after it, unless that task has already started.

A set-time task never starts before its time. If the tasks before it run long, it starts late and the card says so. You can change either choice from the edit pencil on a task.

Two columns on the `tasks` table hold this: `waiting` (on the list, not started yet) and `scheduled_at` (the set time, or null for next in line). Both are added automatically on startup.

## Accounts

New accounts are turned off. The sign in page has no "Create account" button and the server refuses sign ups.

To create an account (for example on a fresh database), set `ALLOW_SIGNUP=true` in `.env` or in the Vercel environment variables, redeploy, create the account, then remove the variable and redeploy again.

## Passwords

Change your password from inside the app with the "Change password" button next to "Log out". You need your current password to do it.

There is no "forgot password" reset on the sign in page, because a reset that only asks for an email lets anyone take over an account. If you forget your password, set a new one by hand:

1. Make a new password hash on your computer:

```sh
node -e "const c=require('crypto');const s=c.randomBytes(16).toString('hex');console.log(s+':'+c.scryptSync(process.argv[1],s,64).toString('hex'))" 'your-new-password'
```

2. Paste the result into the Neon SQL editor:

```sql
update app_users set password_hash = 'PASTE_HASH_HERE' where email = 'you@example.com';
```
