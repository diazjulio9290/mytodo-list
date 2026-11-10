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
